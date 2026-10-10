/**
 * Capability 1 · Project routing. Where each project lives on each machine (ADR-0757): project > machine > trunk folder. The
 * library's server keeps, in a database of its own, one trunk folder per project per machine; the
 * plan, forest and claims stay one per project, shared by every machine. Worktrees are never
 * recorded: a folder in a git worktree of a trunk is in the trunk's project (routing finds it
 * through git).
 *
 * - A machine is named by a stable id kept in `machine.json` in the storytree home, made the first
 *   time it is asked for, with the computer's name beside it to read.
 * - Making a folder a project, and the one check before it, are the app setup story's (ADR-0969 D3):
 *   it records and approves trunks through registerTrunk and approveTrunk.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
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
  /** What approved it (ADR-0942): "setup", "join", or the authority an approval command cited; absent while unapproved. */
  readonly approvedBy?: string;
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
  approved_at  timestamptz,
  approved_by  text,
  PRIMARY KEY (project, machine),
  UNIQUE (machine, folder)
)`;

/** A trunks table made before approval (ADR-0942) gains it, every record unapproved: nothing is grandfathered (D3). */
const APPROVAL = "ALTER TABLE trunks ADD COLUMN IF NOT EXISTS approved_at timestamptz, ADD COLUMN IF NOT EXISTS approved_by text";

/** The trunks database, set up by the library with the table's definitions (ADR-0973). */
function trunksPool(storytree: Storytree): Promise<Pool> {
  return storytree.ownDatabase(TRUNKS_DATABASE, { tables: [SCHEMA, APPROVAL] });
}

/** Every project's trunk on `machine`. */
export async function trunksOn(storytree: Storytree, machine: string): Promise<Trunk[]> {
  const pool = await trunksPool(storytree);
  const { rows } = await pool.query<{ project: string; machine: string; machine_name: string; folder: string; approved_by: string | null }>(
    "SELECT project, machine, machine_name, folder, CASE WHEN approved_at IS NULL THEN NULL ELSE coalesce(approved_by, '') END AS approved_by FROM trunks WHERE machine = $1 ORDER BY project",
    [machine],
  );
  return rows.map((row) => ({ project: row.project, machine: row.machine, machineName: row.machine_name, folder: row.folder, ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }) }));
}

/**
 * Record `trunk`, approved by `approvedBy` when given, unless its project already has one on its
 * machine or its folder is already some project's there: then nothing is written, and false says so.
 */
export async function registerTrunk(storytree: Storytree, trunk: Trunk, approvedBy?: string): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = await pool.query(
    "INSERT INTO trunks (project, machine, machine_name, folder, approved_at, approved_by) VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $5) ON CONFLICT DO NOTHING",
    [trunk.project, trunk.machine, trunk.machineName, trunk.folder, approvedBy ?? null],
  );
  return rowCount === 1;
}

/**
 * Approve the trunk recorded for `project` on `machine` at `folder` (exactly as recorded), citing
 * `by`: a deliberate join, or the authority an approval command names (ADR-0942 D1). False when no
 * such trunk is recorded: approval never makes a trunk.
 */
export async function approveTrunk(storytree: Storytree, { project, machine, folder }: { project: string; machine: string; folder: string }, by: string): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = await pool.query(
    "UPDATE trunks SET approved_at = now(), approved_by = $4 WHERE project = $1 AND machine = $2 AND folder = $3",
    [project, machine, folder, by],
  );
  return rowCount === 1;
}

/** `project`'s approved trunk on `machine` when `folder` (canonical, in its main checkout) is it or inside it; else undefined. */
export async function approvedTrunk(storytree: Storytree, project: string, machine: string, folder: string): Promise<Trunk | undefined> {
  const own = (await trunksOn(storytree, machine)).find((trunk) => trunk.project === project);
  return own?.approvedBy !== undefined && within(folder, own.folder) ? own : undefined;
}

/**
 * Forget `project`'s trunk on `machine`, as when the project is removed from it, or on every machine
 * when none is named, as when it is deleted; false when there was none. The approval `home` remembers
 * for it on that machine goes with it, so a folder later at the same place is asked about afresh.
 */
export async function forgetTrunk(storytree: Storytree, { project, machine }: { project: string; machine?: string }, home: string = storytreeHome()): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = machine === undefined
    ? await pool.query("DELETE FROM trunks WHERE project = $1", [project])
    : await pool.query("DELETE FROM trunks WHERE project = $1 AND machine = $2", [project, machine]);
  forgetApproval(home, project, machine);
  return (rowCount ?? 0) > 0;
}

/** The storytree 0.3 home: STORYTREE_HOME, else ~/.storytree/0.3, where the desktop app keeps its Postgres. */
export function storytreeHome(): string {
  const home = process.env.STORYTREE_HOME;
  return home !== undefined && home !== "" ? path.resolve(home) : path.join(homedir(), ".storytree", "0.3");
}

/** Where this machine remembers the approved trunks it has seen (ADR-0942), in its storytree home. */
const APPROVALS_FILE = "approved-trunks.json";

/** The approved trunks `home` remembers and the machine (its id) that saw them; none when unreadable. */
function kept(home: string): { machine: unknown; trunks: { project: string; folder: string }[] } {
  try {
    const { machine, trunks } = JSON.parse(readFileSync(path.join(home, APPROVALS_FILE), "utf8")) as { machine?: unknown; trunks?: unknown };
    if (!Array.isArray(trunks)) return { machine, trunks: [] };
    return { machine, trunks: trunks.filter((trunk): trunk is { project: string; folder: string } => typeof trunk?.project === "string" && typeof trunk?.folder === "string") };
  } catch {
    return { machine: undefined, trunks: [] };
  }
}

/** The approved trunks this machine remembers, as `machine` (its id) saw them. */
export function remembered(home: string, machine: string): { project: string; folder: string }[] {
  const { machine: saw, trunks } = kept(home);
  return saw === machine ? trunks : [];
}

/** Remember `trunk` as approved on `machine`, in place of what was remembered for its project; a failure to write only costs a later ask. */
export function rememberApproval(home: string, machine: string, trunk: { project: string; folder: string }): void {
  keep(home, machine, [...remembered(home, machine).filter((kept) => kept.project !== trunk.project), { project: trunk.project, folder: trunk.folder }]);
}

/** Stop remembering `project`'s approval, when `home` saw it on `machine` (on any machine when none is named). */
function forgetApproval(home: string, project: string, machine?: string): void {
  const { machine: saw, trunks } = kept(home);
  if (typeof saw !== "string" || (machine !== undefined && saw !== machine) || !trunks.some((trunk) => trunk.project === project)) return;
  keep(home, saw, trunks.filter((trunk) => trunk.project !== project));
}

function keep(home: string, machine: string, trunks: readonly { project: string; folder: string }[]): void {
  try {
    mkdirSync(home, { recursive: true });
    const file = path.join(home, APPROVALS_FILE);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ machine, trunks }, null, 2)}\n`);
    renameSync(temp, file);
  } catch {
    // A lost write leaves the file as it was: a remembering is asked again next time.
  }
}

/** Whether `folder` is `root` or inside it. */
function within(folder: string, root: string): boolean {
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** A path as compared: Windows paths ignore case. */
function key(folder: string): string {
  return process.platform === "win32" ? folder.toLowerCase() : folder;
}
