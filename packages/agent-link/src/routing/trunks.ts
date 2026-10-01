/**
 * Where each project lives on each machine (ADR-0757): project > machine > trunk folder. The
 * library's server keeps, in a database of its own, one trunk folder per project per machine; the
 * plan, forest and claims stay one per project, shared by every machine. Worktrees are never
 * recorded: a folder in a git worktree of a trunk is in the trunk's project (routing finds it
 * through git).
 *
 * - A machine is named by a stable id kept in `machine.json` in the storytree home, made the first
 *   time it is asked for, with the computer's name beside it to read.
 * - The one check every way of adding a project goes through (the installer, the app's Add project,
 *   `storytree doctor --set-up`, the agent's set_up_project) is refusal(): it refuses a second trunk
 *   for a project on this machine, a folder that is, is inside, is a worktree of, or holds another
 *   project's trunk, and a name some project already has unless this machine's checkout is joining
 *   it on purpose.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import type { Storytree } from "@storytree/library";
import type { Pool } from "pg";

/** The server's own database holding the trunks. */
export const TRUNKS_DATABASE = "storytree-trunks";

/** This computer, as the trunks know it. */
export interface Machine {
  readonly id: string;
  readonly name: string;
}

/** One project's folder on one machine. */
export interface Trunk {
  readonly project: string;
  readonly machine: string;
  readonly machineName: string;
  readonly folder: string;
}

/** Why a folder cannot be set up as the project asked for. */
export class ProjectFolderError extends Error {
  /** A name no project has yet, when a new project is what the folder should be. */
  readonly suggestion: string | undefined;
  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "ProjectFolderError";
    this.suggestion = suggestion;
  }
}

/** This machine's identity, kept in `home`: made (and written) the first time. */
export function machineOf(home: string): Machine {
  const file = path.join(home, "machine.json");
  try {
    const { id, name } = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown; name?: unknown };
    if (typeof id === "string" && id !== "") return { id, name: typeof name === "string" && name !== "" ? name : id };
  } catch {
    // Missing or unreadable: made afresh below.
  }
  const machine = { id: randomUUID(), name: hostname().trim() || "this computer" };
  mkdirSync(home, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(machine, null, 2)}\n`);
  renameSync(temp, file);
  return machine;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS trunks (
  project      text NOT NULL,
  machine      text NOT NULL,
  machine_name text NOT NULL,
  folder       text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project, machine),
  UNIQUE (machine, folder)
)`;

async function trunksPool(storytree: Storytree): Promise<Pool> {
  const pool = await storytree.ownDatabase(TRUNKS_DATABASE);
  await setUpTrunks(pool);
  return pool;
}

/**
 * Make the trunks table in `pool`'s database unless it is there. First setups can race (the app,
 * an agent and the CLI on a new server), and two concurrent CREATE TABLE IF NOT EXISTS can collide
 * on the table's type, so they take turns on an advisory lock.
 */
export async function setUpTrunks(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.trunks-schema'))");
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (error) {
    failed = true;
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(failed);
  }
}

/** Every project's trunk on `machine`. */
export async function trunksOn(storytree: Storytree, machine: string): Promise<Trunk[]> {
  const pool = await trunksPool(storytree);
  const { rows } = await pool.query<{ project: string; machine: string; machine_name: string; folder: string }>(
    "SELECT project, machine, machine_name, folder FROM trunks WHERE machine = $1 ORDER BY project",
    [machine],
  );
  return rows.map((row) => ({ project: row.project, machine: row.machine, machineName: row.machine_name, folder: row.folder }));
}

/**
 * Record `trunk`, unless its project already has one on its machine or its folder is already some
 * project's there: then nothing is written, and false says so.
 */
export async function registerTrunk(storytree: Storytree, trunk: Trunk): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = await pool.query(
    "INSERT INTO trunks (project, machine, machine_name, folder) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [trunk.project, trunk.machine, trunk.machineName, trunk.folder],
  );
  return rowCount === 1;
}

/** Forget `project`'s trunk on `machine`, as when the project is removed from it, or on every machine when none is named, as when it is deleted; false when there was none. */
export async function forgetTrunk(storytree: Storytree, { project, machine }: { project: string; machine?: string }): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = machine === undefined
    ? await pool.query("DELETE FROM trunks WHERE project = $1", [project])
    : await pool.query("DELETE FROM trunks WHERE project = $1 AND machine = $2", [project, machine]);
  return (rowCount ?? 0) > 0;
}

/** `name`, or the first of `name-2`, `name-3`… that is no project yet, within the project-name length. */
export function unusedName(name: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = `${name.slice(0, 40 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export interface Asked {
  /** The folder, canonical. */
  readonly folder: string;
  /** Where the folder sits in its trunk's main checkout, when it is in a git worktree; else the folder. */
  readonly inMain: string;
  readonly project: string;
  /** Adding this machine's checkout to an existing project, on purpose (ADR-0757 D4). */
  readonly join: boolean;
  /** Every project on the server. */
  readonly projects: readonly string[];
  /** This machine's trunks. */
  readonly trunks: readonly Trunk[];
  /** The name to suggest for the folder if it is new. */
  readonly suggestion: string;
}

/** Why `asked` must be refused, or undefined when the folder may be set up as its project. */
export function refusal(asked: Asked): ProjectFolderError | undefined {
  for (const trunk of asked.trunks) {
    if (within(asked.folder, trunk.folder) || within(asked.inMain, trunk.folder)) {
      if (trunk.project === asked.project && samePath(asked.folder, trunk.folder)) continue;
      return new ProjectFolderError(`${asked.folder} is part of storytree project "${trunk.project}" (its folder on this machine is ${trunk.folder}), so it cannot be set up again or added to another project.`);
    }
    if (within(trunk.folder, asked.folder)) {
      return new ProjectFolderError(`${asked.folder} holds storytree project "${trunk.project}"'s folder ${trunk.folder}; projects never share a folder, so choose a folder that holds no project.`);
    }
  }
  const own = asked.trunks.find((trunk) => trunk.project === asked.project);
  // Setting its own trunk up again (after a setup that failed on this machine, say) is no new folder.
  if (own !== undefined && samePath(own.folder, asked.folder)) return undefined;
  if (own !== undefined) {
    return new ProjectFolderError(`storytree project "${asked.project}" already lives at ${own.folder} on this machine, and a project has one folder per machine: work in a git worktree of it (git worktree add), or set this folder up as a new project, such as "${asked.suggestion}".`, asked.suggestion);
  }
  const exists = asked.projects.includes(asked.project);
  if (exists && !asked.join) {
    return new ProjectFolderError(`There is already a storytree project called "${asked.project}". A new folder gets its own project: set it up as "${asked.suggestion}". To make this folder "${asked.project}"'s checkout on this machine, add it to "${asked.project}" on purpose: \`storytree doctor --join ${asked.project}\` here, or ask your agent to join it.`, asked.suggestion);
  }
  if (!exists && asked.join) {
    return new ProjectFolderError(`There is no storytree project called "${asked.project}" to add this machine's checkout to.`, asked.suggestion);
  }
  return undefined;
}

/** Whether `folder` is `root` or inside it. */
function within(folder: string, root: string): boolean {
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(a: string, b: string): boolean {
  return key(a) === key(b);
}

/** A path as compared: Windows paths ignore case. */
function key(folder: string): string {
  return process.platform === "win32" ? folder.toLowerCase() : folder;
}
