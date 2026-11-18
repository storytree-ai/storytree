import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { setUpProject } from "@storytree/app-setup/project";
import { connect, type Library } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { removeTemp } from "@storytree/test-waits";

import { buildCommand } from "../bins/build.js";

export function testServerUrl(): string {
  return required(
    "STORYTREE_TEST_PG_URL",
    "run the tests via `pnpm test`, which starts a local Postgres, or set STORYTREE_TEST_PG_URL to a server the tests may create and drop databases on",
  );
}

export function testServerDataDir(): string {
  return required("STORYTREE_TEST_PG_DATA", "run the tests via `pnpm test`, which starts the test Postgres through @storytree/local-postgres");
}

export function placeTestServer(dataDir: string): void {
  writeFileSync(`${dataDir}.owner.json`, readFileSync(`${testServerDataDir()}.owner.json`));
  placeHandoff(dataDir);
}

export function placeHandoff(dataDir: string): void {
  const handoff = path.join(`${testServerDataDir()}.auth`, "connection.json");
  if (!existsSync(handoff)) return;
  const directory = `${dataDir}.auth`;
  const file = path.join(directory, "connection.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privatePath(directory, true);
  writeFileSync(file, readFileSync(handoff), { mode: 0o600 });
  privatePath(file, false);
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

export async function dropTestProjects(projects: Iterable<string>): Promise<void> {
  await dropTestDatabases([...projects].map((name) => `storytree_${name}`));
}

export class BuiltCommand {
  #dir: string | undefined;
  #script: string | undefined;

  async build(builder: (dir: string) => Promise<string> = buildCommand): Promise<void> {
    this.#dir = mkdtempSync(path.join(tmpdir(), "storytree-cli-bin-"));
    this.#script = await builder(this.#dir);
  }

  remove(): void {
    if (this.#dir !== undefined) rmSync(this.#dir, { recursive: true, force: true });
  }

  get script(): string {
    if (this.#script === undefined) throw new Error("build the command first");
    return this.#script;
  }

  get dir(): string {
    return path.dirname(this.script);
  }
}

export interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

export function assertExitCode(ran: Pick<Ran, "code" | "stdout" | "stderr">, expected: number, context = "built command"): void {
  assert.equal(ran.code, expected, `${context}\nstderr:\n${ran.stderr}\nstdout:\n${ran.stdout}`);
}

export interface RunOptions {
  readonly cwd: string;
  readonly home: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
}

export function storytree(script: string, args: readonly string[], options: RunOptions): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const given = { CLAUDE_CODE_SESSION_ID: "", CLAUDECODE: "", CODEX_THREAD_ID: "", ...options.env, STORYTREE_HOME: options.home };
    const env: Record<string, string | undefined> = { ...process.env };
    for (const name of Object.keys(given)) for (const own of Object.keys(env)) if (own.toLowerCase() === name.toLowerCase()) delete env[own];
    const child = spawn(process.execPath, [script, ...args], {
      cwd: options.cwd,
      env: { ...env, ...given },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      shell: false,
    });
    if (options.input !== undefined) child.stdin!.end(options.input);
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: performance.now() - started }));
  });
}

export interface World {
  readonly project: string;
  readonly folder: string;
  readonly elsewhere: string;
  readonly home: string;
  readonly stoppedHome: string;
  run(args: readonly string[], env?: Readonly<Record<string, string>>): Promise<Ran>;
  library(): Promise<Library>;
}

export async function inWorld(command: BuiltCommand, body: (world: World) => Promise<void>): Promise<void> {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-cli-")));
  const project = uniqueProjectName();
  const storytreeServer = await connect({ url: testServerUrl() });
  try {
    const folder = path.join(dir, "site");
    const elsewhere = path.join(dir, "elsewhere");
    const home = path.join(dir, "home");
    const stoppedHome = path.join(dir, "stopped-home");
    for (const made of [folder, elsewhere, home, stoppedHome]) mkdirSync(made, { recursive: true });
    placeTestServer(path.join(home, "pgdata"));
    const opened: Promise<Library> = storytreeServer.openProject(project);
    await opened;
    await setUpProject({ folder, project, storytree: storytreeServer, storytreeHome: home, join: true });
    rmSync(path.join(home, "project-choice.json"), { force: true });
    await body({
      project,
      folder,
      elsewhere,
      home,
      stoppedHome,
      run: (args, env) => storytree(command.script, args, { cwd: folder, home, ...(env === undefined ? {} : { env }) }),
      library: () => opened,
    });
  } finally {
    await storytreeServer.close();
    await dropTestProjects([project]);
    await removeTemp(dir);
  }
}

function required(name: string, how: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set: ${how}.`);
  return value;
}
