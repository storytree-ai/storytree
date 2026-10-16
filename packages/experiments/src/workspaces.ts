/**
 * Capability 2 · Arm workspaces (ADR-1064 D3). Each arm of an experiment gets a throwaway library and storytree home of
 * its own: a login role named `x-<experiment>-<arm>` on the cluster, the database of the project of that name
 * (`storytree_x-<experiment>-<arm>`, as the library names a project's), owned by the role, and a home whose settings.json
 * points the library at that database as that role and names the experiment and arm, with the role's password saved as
 * its `postgres` key. A lane given that home as STORYTREE_HOME writes nowhere else, and its doors read its arm.
 *
 * The role is made with no rights beyond its own database, so it reaches nothing of the real project's. Making refuses an
 * arm already made, and dropping removes only what the arm's own names spell, and a home only when it names that arm, so
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
 * password) is `server`; its home at `home`, which must not exist yet. Refused, with nothing made, when the arm's role or
 * database is already there; a failure part way undoes what was made.
 */
export async function makeArm(admin: Admin, server: string, experiment: string, arm: string, home: string): Promise<MadeArm> {
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
  } catch (error) {
    // The home did not exist before, so all of it is this make's.
    await dropMade(admin, workspace).catch(() => undefined);
    throw error;
  }
  return { ...workspace, address: address.href };
}

/**
 * Drop `arm`'s workspace for `experiment`: its database, ending the connections still on it, its role, and its home at
 * `home`. What is already gone is skipped. Refused, with nothing dropped, when `home` exists but is not that arm's home.
 */
export async function dropArm(admin: Admin, experiment: string, arm: string, home: string): Promise<void> {
  const workspace = armWorkspace(experiment, arm, home);
  const folder = workspace.home;
  if (existsSync(folder)) {
    const named = readExperiment(folder);
    if (named?.name !== experiment || named.arm !== arm) {
      throw new Error(`${folder} is not the home of arm "${arm}" of experiment "${experiment}": its settings name ${named === undefined ? "no arm" : `arm "${named.arm}" of experiment "${named.name}"`}. Nothing was dropped.`);
    }
  }
  await dropMade(admin, workspace);
}

async function dropMade(admin: Admin, { role, database, home }: ArmWorkspace): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS ${quoted(role)}`);
  rmSync(home, { recursive: true, force: true });
}

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
