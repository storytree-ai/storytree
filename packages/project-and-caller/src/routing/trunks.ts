// Capability 1 · Project routing
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";

import type { Storytree } from "@storytree/library";
import type { Pool } from "pg";

export const TRUNKS_DATABASE = "storytree-trunks";

export interface Machine {
  readonly id: string;
  readonly name: string;
}

export interface Trunk {
  readonly project: string;
  readonly machine: string;
  readonly machineName: string;
  readonly folder: string;
  readonly approvedBy?: string;
}

export interface ImportedFolder {
  readonly project: string;
  readonly machine: string;
  readonly machineName: string;
  readonly folder: string;
  readonly repository?: string;
  readonly commit?: string;
}

export class ProjectFolderError extends Error {
  readonly suggestion: string | undefined;
  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "ProjectFolderError";
    this.suggestion = suggestion;
  }
}

export function machineOf(home: string): Machine {
  const file = path.join(home, "machine.json");
  try {
    const { id, name } = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown; name?: unknown };
    if (typeof id === "string" && id !== "") return { id, name: typeof name === "string" && name !== "" ? name : id };
  } catch {
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

const APPROVAL = "ALTER TABLE trunks ADD COLUMN IF NOT EXISTS approved_at timestamptz, ADD COLUMN IF NOT EXISTS approved_by text";

const IMPORTS = `CREATE TABLE IF NOT EXISTS imports (
  project      text NOT NULL,
  machine      text NOT NULL,
  machine_name text NOT NULL,
  folder       text NOT NULL,
  repository   text,
  commit_sha   text,
  at           timestamptz NOT NULL DEFAULT now(),
  approved_by  text NOT NULL,
  PRIMARY KEY (project, machine, folder)
)`;

export function trunksPool(storytree: Pick<Storytree, "ownDatabase">, more?: { readonly tables: readonly string[]; readonly declaredIn: readonly (string | undefined)[] }): Promise<Pool> {
  return storytree.ownDatabase(TRUNKS_DATABASE, {
    tables: [SCHEMA, APPROVAL, IMPORTS, ...(more?.tables ?? [])],
    declaredIn: [import.meta.url, ...(more?.declaredIn ?? [])],
  });
}

export async function recordImport(storytree: Storytree, imported: ImportedFolder): Promise<void> {
  const pool = await trunksPool(storytree);
  await pool.query(
    `INSERT INTO imports (project, machine, machine_name, folder, repository, commit_sha, approved_by) VALUES ($1, $2, $3, $4, $5, $6, 'import')
     ON CONFLICT (project, machine, folder) DO UPDATE SET machine_name = excluded.machine_name, repository = excluded.repository, commit_sha = excluded.commit_sha, at = now()`,
    [imported.project, imported.machine, imported.machineName, imported.folder, imported.repository ?? null, imported.commit ?? null],
  );
}

export async function importsOf(storytree: Pick<Storytree, "ownDatabase">, project: string, machine: string): Promise<(ImportedFolder & { readonly approvedBy: string })[]> {
  const pool = await trunksPool(storytree);
  const { rows } = await pool.query<{ project: string; machine: string; machine_name: string; folder: string; repository: string | null; commit_sha: string | null; approved_by: string }>(
    "SELECT project, machine, machine_name, folder, repository, commit_sha, approved_by FROM imports WHERE project = $1 AND machine = $2 ORDER BY folder",
    [project, machine],
  );
  return rows.map((row) => ({
    project: row.project,
    machine: row.machine,
    machineName: row.machine_name,
    folder: row.folder,
    ...(row.repository === null ? {} : { repository: row.repository }),
    ...(row.commit_sha === null ? {} : { commit: row.commit_sha }),
    approvedBy: row.approved_by,
  }));
}

export async function trunksOn(storytree: Storytree, machine: string): Promise<Trunk[]> {
  const pool = await trunksPool(storytree);
  const { rows } = await pool.query<{ project: string; machine: string; machine_name: string; folder: string; approved_by: string | null }>(
    "SELECT project, machine, machine_name, folder, CASE WHEN approved_at IS NULL THEN NULL ELSE coalesce(approved_by, '') END AS approved_by FROM trunks WHERE machine = $1 ORDER BY project",
    [machine],
  );
  return rows.map((row) => ({ project: row.project, machine: row.machine, machineName: row.machine_name, folder: row.folder, ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }) }));
}

export async function trunkedProjects(storytree: Storytree): Promise<Set<string>> {
  const pool = await trunksPool(storytree);
  const { rows } = await pool.query<{ project: string }>("SELECT DISTINCT project FROM trunks");
  return new Set(rows.map((row) => row.project));
}

export async function registerTrunk(storytree: Storytree, trunk: Trunk, approvedBy?: string): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = await pool.query(
    "INSERT INTO trunks (project, machine, machine_name, folder, approved_at, approved_by) VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $5) ON CONFLICT DO NOTHING",
    [trunk.project, trunk.machine, trunk.machineName, trunk.folder, approvedBy ?? null],
  );
  return rowCount === 1;
}

export async function approveTrunk(storytree: Storytree, { project, machine, folder }: { project: string; machine: string; folder: string }, by: string): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = await pool.query(
    "UPDATE trunks SET approved_at = now(), approved_by = $4 WHERE project = $1 AND machine = $2 AND folder = $3",
    [project, machine, folder, by],
  );
  return rowCount === 1;
}

export async function approvedTrunk(storytree: Storytree, project: string, machine: string, folder: string): Promise<Trunk | undefined> {
  const own = (await trunksOn(storytree, machine)).find((trunk) => trunk.project === project);
  return own?.approvedBy !== undefined && within(folder, own.folder) ? own : undefined;
}

export async function forgetTrunk(storytree: Storytree, { project, machine }: { project: string; machine?: string }, home: string = storytreeHome()): Promise<boolean> {
  const pool = await trunksPool(storytree);
  const { rowCount } = machine === undefined
    ? await pool.query("DELETE FROM trunks WHERE project = $1", [project])
    : await pool.query("DELETE FROM trunks WHERE project = $1 AND machine = $2", [project, machine]);
  if (machine === undefined) await pool.query("DELETE FROM imports WHERE project = $1", [project]);
  else await pool.query("DELETE FROM imports WHERE project = $1 AND machine = $2", [project, machine]);
  forgetApproval(home, project, machine);
  return (rowCount ?? 0) > 0;
}

export function storytreeHome(): string {
  const home = process.env.STORYTREE_HOME;
  return home !== undefined && home !== "" ? path.resolve(home) : path.join(homedir(), ".storytree", "0.3");
}

const APPROVALS_FILE = "approved-trunks.json";

function kept(home: string): { machine: unknown; trunks: { project: string; folder: string }[] } {
  try {
    const { machine, trunks } = JSON.parse(readFileSync(path.join(home, APPROVALS_FILE), "utf8")) as { machine?: unknown; trunks?: unknown };
    if (!Array.isArray(trunks)) return { machine, trunks: [] };
    return { machine, trunks: trunks.filter((trunk): trunk is { project: string; folder: string } => typeof trunk?.project === "string" && typeof trunk?.folder === "string") };
  } catch {
    return { machine: undefined, trunks: [] };
  }
}

export function remembered(home: string, machine: string): { project: string; folder: string }[] {
  const { machine: saw, trunks } = kept(home);
  return saw === machine ? trunks : [];
}

export function rememberApproval(home: string, machine: string, trunk: { project: string; folder: string }): void {
  keep(home, machine, [...remembered(home, machine).filter((kept) => kept.project !== trunk.project), { project: trunk.project, folder: trunk.folder }]);
}

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
  }
}

function within(folder: string, root: string): boolean {
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function key(folder: string): string {
  return process.platform === "win32" ? folder.toLowerCase() : folder;
}
