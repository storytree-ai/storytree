// Capability 11 · Machines
import { hostname } from "node:os";

import type { Storytree } from "@storytree/library";

import { machineOf, storytreeHome, trunksPool } from "@storytree/project-and-caller";

export type Server = Pick<Storytree, "ownDatabase">;

export interface MachineRecord {
  readonly id: string;
  readonly hostname: string;
  readonly name?: string;
}

export interface Here {
  readonly home?: string;
  readonly host?: string;
}

const SHORT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export const NO_MACHINE = "none";

export const CLOUD_MACHINE = "cloud";

const SCHEMA = `CREATE TABLE IF NOT EXISTS machines (
  id       text PRIMARY KEY,
  hostname text NOT NULL,
  name     text NOT NULL UNIQUE,
  at       timestamptz NOT NULL DEFAULT now()
)`;

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

function hostOf(here: Here): string {
  return here.host ?? (hostname().trim() || "this computer");
}

export async function nameThisMachine(server: Server, name: string, here: Here = {}): Promise<MachineRecord> {
  if (name === NO_MACHINE) throw new MachineNameError(`"${NO_MACHINE}" clears an increment's machine, so no machine is called it`, true);
  if (name === CLOUD_MACHINE) throw new MachineNameError(`"${CLOUD_MACHINE}" names a cloud container on an increment, so no machine is called it`, true);
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
    if ((error as { code?: string }).code === "23505") return { rows: [] };
    throw error;
  });
  if (rows.length === 0) throw new MachineNameError(`"${name}" already names another machine`, false);
  return { id, hostname: host, name };
}

export async function thisComputer(server: Server, here: Here = {}): Promise<MachineRecord> {
  const { id } = machineOf(here.home ?? storytreeHome());
  const db = await pool(server);
  const { rows } = await db.query<{ name: string }>("SELECT name FROM machines WHERE id = $1", [id]);
  return { id, hostname: hostOf(here), ...(rows[0] === undefined ? {} : { name: rows[0].name }) };
}

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

export async function machineNames(server: Server): Promise<Map<string, string>> {
  const db = await pool(server);
  const { rows } = await db.query<{ hostname: string; name: string }>("SELECT hostname, name FROM machines ORDER BY at");
  return new Map(rows.map((row) => [row.hostname, row.name]));
}

export async function incrementMachine(server: Server, name: string): Promise<string | undefined> {
  if (name === NO_MACHINE) return undefined;
  if (name === CLOUD_MACHINE) return name;
  const known = [...new Set((await machineNames(server)).values())].sort();
  if (known.includes(name)) return name;
  const said = known.length === 0 ? "no machine is named yet (storytree machine name <name> names one)" : `the named machines are ${known.join(", ")}`;
  throw new MachineNameError(`no machine is called "${name}": ${said}, "${CLOUD_MACHINE}" names a cloud container, and "${NO_MACHINE}" clears it`, false);
}
