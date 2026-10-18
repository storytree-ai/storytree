/**
 * Capability 2 · Arm workspaces (ADR-1064 D3). Each arm of an experiment gets a throwaway library and storytree home of
 * its own: a login role named `x-<experiment>-<arm>` on the cluster, the database of the project of that name
 * (`storytree_x-<experiment>-<arm>`, as the library names a project's), owned by the role, and a home whose settings.json
 * points the library at that database as that role and names the experiment and arm, with the role's password saved as
 * its `postgres` key. A lane given that home as STORYTREE_HOME writes nowhere else, and its doors read its arm.
 *
 * The role is never given the real project's database. Beside its own, it is granted what a lane's doors use in the
 * server's shared own databases, where ADR-1064 D2 and D4 want its activity lines and QA ledger rows: it reads and adds to
 * the activity log and the QA ledger, reads routing and the experiment points, and deletes nowhere. Making refuses an arm
 * already made, and dropping removes only what the arm's own names spell, and a home only when it names that arm, so
 * neither can reach the real library's records.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { saveKey } from "@storytree/keys";
import { readExperiment } from "@storytree/project-and-caller";

/** Something SQL can be run on, with values: a pg Client or Pool signed in as the cluster's admin. */
export interface Admin {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** Run `body` signed in as the cluster's admin on another of its databases. */
export type OnDatabase = <T>(database: string, body: (admin: Admin) => Promise<T>) => Promise<T>;

/** One of the server's own databases a lane's doors open beside its library, and whether the lane adds to it or only reads. */
export interface SharedDatabase {
  readonly database: string;
  readonly write: boolean;
}

/**
 * The server's own databases an arm's lanes use (ADR-1064 D2, D4): the activity log and the QA ledger, which they add to,
 * and routing and the experiment points, which they only read, so no lane can write its own curve.
 */
export const SHARED_DATABASES: readonly SharedDatabase[] = [
  { database: "storytree-activity", write: true },
  { database: "storytree-quality", write: true },
  { database: "storytree-trunks", write: false },
  { database: "storytree-experiments", write: false },
];

/**
 * How an arm's grants in the shared databases are made: the way to reach each, and which ones (SHARED_DATABASES by
 * default). Making or dropping an arm without them leaves the shared databases alone: the arm's own library only.
 */
export interface SharedOptions {
  readonly onDatabase: OnDatabase;
  readonly shared?: readonly SharedDatabase[];
}

const OWN_ONLY: SharedOptions = { onDatabase: () => Promise.reject(new Error("No shared database is reached.")), shared: [] };

/** What an arm's workspace is called on the cluster, and where its home is. */
export interface ArmWorkspace {
  /** The login role, and the name of the project the arm's lanes open. */
  readonly role: string;
  readonly project: string;
  /** The project's database, which the role owns. */
  readonly database: string;
  readonly home: string;
}

/** An arm's workspace once made: the address its home's library setting holds. */
export interface MadeArm extends ArmWorkspace {
  readonly address: string;
  /** The shared databases its role was granted; one the server does not hold yet is skipped. */
  readonly granted: readonly string[];
}

const WORDS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The names of `arm`'s workspace for `experiment`, its home at `home`. Refused when the experiment or the arm is not
 * lower-case words joined by hyphens, or the name would break the library's 40-character project names.
 */
export function armWorkspace(experiment: string, arm: string, home: string): ArmWorkspace {
  if (!WORDS.test(experiment)) throw new Error(`An experiment's name is lower-case letters and digits, in words joined by single hyphens: "${experiment}" is not.`);
  if (!WORDS.test(arm)) throw new Error(`An arm's name is lower-case letters and digits, in words joined by single hyphens: "${arm}" is not.`);
  const role = `x-${experiment}-${arm}`;
  if (role.length > 40) throw new Error(`An arm's name, x-<experiment>-<arm>, is a project's name, of at most 40 characters: "${role}" has ${role.length}. Shorten the experiment's name.`);
  return { role, project: role, database: `storytree_${role}`, home: path.resolve(home) };
}

/**
 * Make `arm`'s workspace for `experiment` on the cluster `admin` is signed in to, whose address (a postgres:// URL with no
 * password) is `server`; its home at `home`, which must not exist yet, and its role's grants in the shared databases.
 * Refused, with nothing made, when the arm's role or database is already there; a failure part way undoes what was made.
 */
export async function makeArm(admin: Admin, server: string, experiment: string, arm: string, home: string, options: SharedOptions = OWN_ONLY): Promise<MadeArm> {
  const workspace = armWorkspace(experiment, arm, home);
  const { role, database } = workspace;
  const [found] = (await admin.query<{ roles: number; databases: number }>(
    "SELECT (SELECT count(*)::int FROM pg_roles WHERE rolname = $1) AS roles, (SELECT count(*)::int FROM pg_database WHERE datname = $2) AS databases",
    [role, database],
  )).rows;
  if (found!.roles + found!.databases > 0) throw new Error(`Arm "${arm}" of experiment "${experiment}" is already made (${role}): drop it first.`);
  if (existsSync(workspace.home)) throw new Error(`The arm's home ${workspace.home} already exists: give a folder that does not.`);

  const address = new URL(server);
  address.username = role;
  address.password = "";
  address.pathname = `/${encodeURIComponent(database)}`;
  const password = randomBytes(24).toString("hex");
  let granted: readonly string[];
  try {
    await admin.query(`CREATE ROLE ${quoted(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    // The admin takes the role on, so it may make the role's database and drop it again without being a superuser.
    await admin.query(`GRANT ${quoted(role)} TO CURRENT_USER`);
    await admin.query(`CREATE DATABASE ${quoted(database)} OWNER ${quoted(role)}`);
    mkdirSync(workspace.home, { recursive: true });
    writeFileSync(
      path.join(workspace.home, "settings.json"),
      `${JSON.stringify({ library: { location: "postgres", address: address.href }, experiment: { name: experiment, arm } }, null, 2)}\n`,
    );
    saveKey("postgres", password, { home: workspace.home });
    granted = await grantShared(admin, role, options);
  } catch (error) {
    // The home did not exist before, so all of it is this make's.
    await dropMade(admin, workspace, options).catch(() => undefined);
    throw error;
  }
  return { ...workspace, address: address.href, granted };
}

/**
 * Grant `arm`'s role of `experiment`, already made, what its lanes use in the shared databases, as making it does: for an
 * arm made before making granted them, or a shared database the server set up since. Granting again changes nothing.
 * Refused when the arm is not made. Gives the shared databases granted.
 */
export async function grantArm(admin: Admin, experiment: string, arm: string, options: SharedOptions): Promise<readonly string[]> {
  const { role } = armWorkspace(experiment, arm, ".");
  if ((await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rows.length === 0) {
    throw new Error(`Arm "${arm}" of experiment "${experiment}" is not made (no role ${role}): make it first.`);
  }
  return grantShared(admin, role, options);
}

/**
 * In each shared database the server holds: reading every table, adding to and changing rows where the lane writes (never
 * the record of what was set up), and the same on tables its owner sets up later. Nothing deletes.
 */
async function grantShared(admin: Admin, role: string, { onDatabase, shared = SHARED_DATABASES }: SharedOptions): Promise<readonly string[]> {
  const held = new Map((await admin.query<{ name: string; owner: string }>(
    "SELECT datname AS name, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ANY($1)",
    [shared.map((one) => one.database)],
  )).rows.map((row) => [row.name, row.owner]));
  const granted: string[] = [];
  for (const { database, write } of shared) {
    const owner = held.get(database);
    if (owner === undefined) continue;
    const rights = write ? "SELECT, INSERT, UPDATE" : "SELECT";
    await onDatabase(database, async (there) => {
      await there.query(`GRANT CONNECT ON DATABASE ${quoted(database)} TO ${quoted(role)}`);
      await there.query(`GRANT ${rights} ON ALL TABLES IN SCHEMA public TO ${quoted(role)}`);
      await there.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoted(owner)} IN SCHEMA public GRANT ${rights} ON TABLES TO ${quoted(role)}`);
      if (write) {
        await there.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${quoted(role)}`);
        await there.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoted(owner)} IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${quoted(role)}`);
        const setup = await there.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'storytree_setup'");
        if (setup.rows.length > 0) await there.query(`REVOKE INSERT, UPDATE ON storytree_setup FROM ${quoted(role)}`);
      }
    });
    granted.push(database);
  }
  return granted;
}

/**
 * Drop `arm`'s workspace for `experiment`: its database, ending the connections still on it, its role, and its home at
 * `home`. What is already gone is skipped. Refused, with nothing dropped, when `home` exists but is not that arm's home.
 */
export async function dropArm(admin: Admin, experiment: string, arm: string, home: string, options: SharedOptions = OWN_ONLY): Promise<void> {
  const workspace = armWorkspace(experiment, arm, home);
  const folder = workspace.home;
  if (existsSync(folder)) {
    const named = readExperiment(folder);
    if (named?.name !== experiment || named.arm !== arm) {
      throw new Error(`${folder} is not the home of arm "${arm}" of experiment "${experiment}": its settings name ${named === undefined ? "no arm" : `arm "${named.arm}" of experiment "${named.name}"`}. Nothing was dropped.`);
    }
  }
  await dropMade(admin, workspace, options);
}

async function dropMade(admin: Admin, { role, database, home }: ArmWorkspace, { onDatabase, shared = SHARED_DATABASES }: SharedOptions): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
  const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rows.length > 0;
  if (exists) {
    // Its grants in the shared databases go first, or the role could not be dropped; it owns nothing there.
    const held = (await admin.query<{ name: string }>("SELECT datname AS name FROM pg_database WHERE datname = ANY($1)", [shared.map((one) => one.database)])).rows;
    for (const { name } of held) await onDatabase(name, (there) => there.query(`DROP OWNED BY ${quoted(role)}`));
  }
  await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
  rmSync(home, { recursive: true, force: true });
}

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
