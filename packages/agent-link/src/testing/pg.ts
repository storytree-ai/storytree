/**
 * Helpers for the agent link's tests that need a real Postgres.
 *
 * `pnpm test` (packages/dev-loop/src/test.mjs) starts a throwaway local server through @storytree/local-postgres
 * and hands it to the tests as STORYTREE_TEST_PG_URL, with its data directory as
 * STORYTREE_TEST_PG_DATA. A Postgres test must never skip silently, so asking for either when it is
 * missing throws.
 *
 * The library keeps its own test helpers inside its package, where nothing outside it can import
 * them, so the few the agent link needs are restated here.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connect } from "@storytree/library";

import pg from "pg";

import { requireApproval } from "../routing/routing.js";
import { machineOf, registerTrunk } from "../routing/trunks.js";

/** What uniqueProjectName() puts in every name; the only databases dropTestDatabases() will drop. */
const TEST_TOKEN = /t-[0-9a-f]{8}/;

/** The server the tests run against. Throws when there is none. */
export function testServerUrl(): string {
  return required(
    "STORYTREE_TEST_PG_URL",
    "run the tests via `pnpm test`, which starts a local Postgres, or set STORYTREE_TEST_PG_URL to a server the tests may create and drop databases on",
  );
}

/**
 * The test server's data directory, as @storytree/local-postgres started it: its owner record
 * (`<dataDir>.owner.json`) is the real thing project routing reads. Throws when there is none.
 */
export function testServerDataDir(): string {
  return required("STORYTREE_TEST_PG_DATA", "run the tests via `pnpm test`, which starts the test Postgres through @storytree/local-postgres");
}

/**
 * Make `dataDir` look like the test server's, as a fake storytree home's `pgdata` does: a copy of
 * its owner record at `<dataDir>.owner.json` and, when the server asks for a password, of its
 * private sign-in handoff at `<dataDir>.auth/connection.json` (ADR-0941), private as discovery
 * checks it. `port` fakes another endpoint (a stand-in in front of the server, or a closed port),
 * written into both so they still agree. A passwordless server has no handoff: only the record is copied.
 * Returns the record as written.
 */
export function placeTestServer(dataDir: string, { port }: { port?: number } = {}): Record<string, unknown> {
  const server = testServerDataDir();
  const copied = JSON.parse(readFileSync(`${server}.owner.json`, "utf8")) as { port: number };
  const owner = { ...copied, port: port ?? copied.port };
  writeFileSync(`${dataDir}.owner.json`, JSON.stringify(owner));
  const handoff = path.join(`${server}.auth`, "connection.json");
  if (!existsSync(handoff)) return owner;
  const directory = `${dataDir}.auth`;
  const file = path.join(directory, "connection.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privatePath(directory, true);
  const credentials = JSON.parse(readFileSync(handoff, "utf8")) as { port: number };
  writeFileSync(file, JSON.stringify({ ...credentials, port: port ?? credentials.port }), { mode: 0o600 });
  privatePath(file, false);
  return owner;
}

let currentSid: string | undefined;

/** Owned by this user and readable by it alone: 0700/0600 on POSIX, a protected access list granting only this user on Windows. */
function privatePath(file: string, directory: boolean): void {
  if (process.platform !== "win32") return chmodSync(file, directory ? 0o700 : 0o600);
  const run = (command: string, args: string[]) => {
    const ran = spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", command), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, windowsHide: true });
    if (ran.error !== undefined || ran.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${ran.error?.message ?? ran.stderr}`);
    return ran.stdout;
  };
  // The numeric SID only, never localized account names; once per process, whose user never changes.
  const sid = currentSid ??= run("whoami.exe", ["/user", "/fo", "csv", "/nh"]).match(/,"(S-1-\d+(?:-\d+)+)"\s*$/)?.[1];
  if (sid === undefined) throw new Error("whoami did not return the current user's SID");
  run("icacls.exe", [file, "/setowner", `*${sid}`]);
  run("icacls.exe", [file, "/inheritance:r", "/grant:r", `*${sid}:F`]);
}

/** A project name no other test, and no earlier run, is using: `t-` and 8 random hex digits. */
export function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

/** The database the library keeps project `name` in: its rule, restated rather than imported. */
export function projectDatabase(name: string): string {
  return `storytree_${name}`;
}

/**
 * Drop the libraries of these test projects, ending any connection still open to them. Missing ones
 * are skipped. Only names carrying a uniqueProjectName() token are accepted, so a mistake in a test
 * can never drop somebody's real database on a shared server.
 */
export async function dropTestProjects(projects: Iterable<string>): Promise<void> {
  const names = [...projects];
  for (const name of names) {
    if (!TEST_TOKEN.test(name)) throw new Error(`refusing to drop project ${JSON.stringify(name)}: test projects are named with uniqueProjectName()`);
  }
  if (names.length === 0) return;
  const client = new pg.Client({ connectionString: testServerUrl() });
  await client.connect();
  try {
    for (const name of names) await client.query(`DROP DATABASE IF EXISTS "${projectDatabase(name)}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

/** The names of every database on the test server. */
export async function databasesOnTestServer(): Promise<string[]> {
  const client = new pg.Client({ connectionString: testServerUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ datname: string }>("SELECT datname FROM pg_database");
    return rows.map((row) => row.datname);
  } finally {
    await client.end();
  }
}

function required(name: string, how: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set: ${how}.`);
  return value;
}

/**
 * Approve `folder` as `project`'s trunk on the machine whose storytree home is `home` (by default
 * the test server's, where a test's tool server keeps its machine), as setting it up would
 * (ADR-0942): for tests that write a project's marker by hand.
 */
export async function approveCheckout(folder: string, project: string, home: string = path.dirname(path.resolve(testServerDataDir()))): Promise<void> {
  const machine = machineOf(home);
  const storytree = await connect({ url: testServerUrl() });
  try {
    await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: realpathSync.native(folder) }, "test");
    // Seen once, as a setup leaves it: the machine remembers it.
    await requireApproval(storytree, project, folder, home);
  } finally {
    await storytree.close();
  }
}
