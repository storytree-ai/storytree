/**
 * Capability 11 · Machines (ADR-0982): the computers that work on a project, each with a short name its owner gives it
 * (laptop, mint), its hostname and its id. The id is machine.json's (Project routing), the hostname what every
 * activity line is stamped with; both are how a computer finds which record is its own, and the short name is what
 * people and increments use. The names are kept in the library server's trunks database beside the trunks, so every
 * machine sharing the library reads the same names. No operating system, address or specification is recorded.
 */
import { hostname } from "node:os";

import type { Storytree } from "@storytree/library";

import { machineOf, storytreeHome, trunksPool } from "@storytree/project-and-caller";

/** Whatever reaches the library server's own databases: a connection to it, or a project's library on it. */
export type Server = Pick<Storytree, "ownDatabase">;

/** A computer, as Machines records it. */
export interface MachineRecord {
  readonly id: string;
  readonly hostname: string;
  /** The short name it was given; absent until it is named. */
  readonly name?: string;
}

/** How a computer knows itself: its storytree home (machine.json) and its hostname. */
export interface Here {
  readonly home?: string;
  readonly host?: string;
}

/** A short name: lowercase letters, digits and hyphens, at most 32, starting and ending with a letter or digit. */
const SHORT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** The word an increment's machine field is cleared with, so no machine is called it. */
export const NO_MACHINE = "none";

const SCHEMA = `CREATE TABLE IF NOT EXISTS machines (
  id       text PRIMARY KEY,
  hostname text NOT NULL,
  name     text NOT NULL UNIQUE,
  at       timestamptz NOT NULL DEFAULT now()
)`;

/** Why a name cannot be given: `misuse` when it is not a short name at all. */
export class MachineNameError extends Error {
  readonly misuse: boolean;
  constructor(message: string, misuse: boolean) {
    super(message);
    this.name = "MachineNameError";
    this.misuse = misuse;
  }
}

function pool(server: Server) {
  return trunksPool(server, { tables: [SCHEMA], declaredIn: [import.meta.url] });
}

/** This computer's hostname, as activity lines are stamped with it. */
function hostOf(here: Here): string {
  return here.host ?? (hostname().trim() || "this computer");
}

/** Give this computer `name`, in place of any name it had; refused when it is not a short name or another machine has it. */
export async function nameThisMachine(server: Server, name: string, here: Here = {}): Promise<MachineRecord> {
  if (name === NO_MACHINE) throw new MachineNameError(`"${NO_MACHINE}" clears an increment's machine, so no machine is called it`, true);
  if (!SHORT_NAME.test(name)) throw new MachineNameError(`"${name}" is not a short name: lowercase letters, digits and hyphens, at most 32, starting and ending with a letter or digit`, true);
  const { id } = machineOf(here.home ?? storytreeHome());
  const host = hostOf(here);
  const db = await pool(server);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO machines (id, hostname, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET hostname = EXCLUDED.hostname, name = EXCLUDED.name, at = now()
     WHERE NOT EXISTS (SELECT 1 FROM machines WHERE name = EXCLUDED.name AND id <> EXCLUDED.id)
     RETURNING id`,
    [id, host, name],
  ).catch((error: unknown) => {
    // Another machine's name: the unique name refuses a first naming, as the guard above refuses a renaming.
    if ((error as { code?: string }).code === "23505") return { rows: [] };
    throw error;
  });
  if (rows.length === 0) throw new MachineNameError(`"${name}" already names another machine`, false);
  return { id, hostname: host, name };
}

/** This computer: its id, its hostname and its name when it has one. */
export async function thisComputer(server: Server, here: Here = {}): Promise<MachineRecord> {
  const { id } = machineOf(here.home ?? storytreeHome());
  const db = await pool(server);
  const { rows } = await db.query<{ name: string }>("SELECT name FROM machines WHERE id = $1", [id]);
  return { id, hostname: hostOf(here), ...(rows[0] === undefined ? {} : { name: rows[0].name }) };
}

/**
 * `project`'s machines: every machine with a trunk of it, and every named machine, each marked whether it is this
 * computer; named ones first, by name, then the rest by hostname.
 */
export async function machinesOf(server: Server, project: string, here: Here = {}): Promise<(MachineRecord & { here: boolean })[]> {
  const self = await thisComputer(server, here);
  const db = await pool(server);
  const { rows } = await db.query<{ id: string; hostname: string; name: string | null }>(
    `SELECT coalesce(m.id, t.machine) AS id, coalesce(m.hostname, t.machine_name) AS hostname, m.name
     FROM machines m FULL JOIN (SELECT machine, machine_name FROM trunks WHERE project = $1) t ON t.machine = m.id
     ORDER BY m.name IS NULL, m.name, hostname`,
    [project],
  );
  const listed = rows.map((row) => ({ id: row.id, hostname: row.id === self.id ? self.hostname : row.hostname, ...(row.name === null ? {} : { name: row.name }), here: row.id === self.id }));
  return listed.some((one) => one.here) ? listed : [...listed, { ...self, here: true }];
}

/** Each named machine's name, by its hostname: how a line stamped with a hostname is shown by name. */
export async function machineNames(server: Server): Promise<Map<string, string>> {
  const db = await pool(server);
  const { rows } = await db.query<{ hostname: string; name: string }>("SELECT hostname, name FROM machines ORDER BY at");
  return new Map(rows.map((row) => [row.hostname, row.name]));
}

/**
 * What an increment's machine field is set to when `name` is given (ADR-0982): a named machine's name is kept,
 * NO_MACHINE clears it (undefined, so any machine can take it), and any other name is refused naming the known ones.
 * Both front doors check here before they set the field.
 */
export async function incrementMachine(server: Server, name: string): Promise<string | undefined> {
  if (name === NO_MACHINE) return undefined;
  const known = [...new Set((await machineNames(server)).values())].sort();
  if (known.includes(name)) return name;
  const said = known.length === 0 ? "no machine is named yet (storytree machine name <name> names one)" : `the named machines are ${known.join(", ")}`;
  throw new MachineNameError(`no machine is called "${name}": ${said}, and "${NO_MACHINE}" clears it`, false);
}
