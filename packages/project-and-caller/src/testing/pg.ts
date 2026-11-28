import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connect, type Storytree } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

import pg from "pg";

import { requireApproval } from "../routing/routing.js";
import { approveTrunk, machineOf, registerTrunk } from "../routing/trunks.js";
import { writeMarker } from "./folders.js";

export function testServerUrl(): string {
  return required(
    "STORYTREE_TEST_PG_URL",
    "run the tests via `pnpm test`, which starts a local Postgres, or set STORYTREE_TEST_PG_URL to a server the tests may create and drop databases on",
  );
}

export function testServerRecordedUrl(): string {
  const url = new URL(testServerUrl());
  url.searchParams.delete("connect_timeout");
  return url.href;
}

export function testServerDataDir(): string {
  return required("STORYTREE_TEST_PG_DATA", "run the tests via `pnpm test`, which starts the test Postgres through @storytree/local-postgres");
}

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

function privatePath(file: string, directory: boolean): void {
  if (process.platform !== "win32") return chmodSync(file, directory ? 0o700 : 0o600);
  const run = (command: string, args: string[]) => {
    const ran = spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", command), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, windowsHide: true });
    if (ran.error !== undefined || ran.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${ran.error?.message ?? ran.stderr}`);
    return ran.stdout;
  };
  const sid = currentSid ??= run("whoami.exe", ["/user", "/fo", "csv", "/nh"]).match(/,"(S-1-\d+(?:-\d+)+)"\s*$/)?.[1];
  if (sid === undefined) throw new Error("whoami did not return the current user's SID");
  run("icacls.exe", [file, "/setowner", `*${sid}`]);
  run("icacls.exe", [file, "/reset"]);
  run("icacls.exe", [file, "/inheritance:r", "/grant:r", `*${sid}:F`]);
}

export function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

export function projectDatabase(name: string): string {
  return `storytree_${name}`;
}

export async function dropTestProjects(projects: Iterable<string>): Promise<void> {
  await dropTestDatabases([...projects].map(projectDatabase));
}

export async function databasesOnTestServer(): Promise<string[]> {
  const client = new pg.Client({ connectionString: testServerUrl() });
  let lost: Error | undefined;
  client.on("error", (error) => {
    lost ??= error;
  });
  await client.connect();
  try {
    const { rows } = await client.query<{ datname: string }>("SELECT datname FROM pg_database");
    return rows.map((row) => row.datname);
  } catch (error) {
    throw lost ?? error;
  } finally {
    await client.end();
  }
}

function required(name: string, how: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set: ${how}.`);
  return value;
}

export async function markedProject(storytree: Storytree, folder: string, project: string, home: string): Promise<void> {
  const library = await storytree.openProject(project);
  const { identity } = library;
  await library.close();
  mkdirSync(folder, { recursive: true });
  writeMarker(folder, `${JSON.stringify({ project, identity }, null, 2)}\n`);
  const machine = machineOf(home);
  const at = realpathSync.native(folder);
  if (!(await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: at }, "test"))) {
    await approveTrunk(storytree, { project, machine: machine.id, folder: at }, "test");
  }
}

export async function approveCheckout(folder: string, project: string, home: string = path.dirname(path.resolve(testServerDataDir()))): Promise<void> {
  const machine = machineOf(home);
  const storytree = await connect({ url: testServerUrl() });
  try {
    await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: realpathSync.native(folder) }, "test");
    await requireApproval(storytree, project, folder, home);
  } finally {
    await storytree.close();
  }
}
