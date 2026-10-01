/**
 * Helpers for the command line's tests: the real, built `storytree` command run as a person's shell
 * runs it, in a throwaway folder and storytree home, against the Postgres `pnpm test` provides.
 *
 * `pnpm test` (packages/dev-loop/src/test.mjs) starts a throwaway local server through @storytree/local-postgres
 * and hands it to the tests as STORYTREE_TEST_PG_URL, with its data directory as
 * STORYTREE_TEST_PG_DATA. "Storytree running" is that server: a throwaway storytree home holds a
 * copy of its owner record, where the app's would be. A Postgres test must never skip silently, so
 * asking for either variable when it is missing throws.
 *
 * The agent link keeps its test helpers inside its package, so the few these tests need are
 * restated here, as it restates the library's.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { connect, type Library } from "@storytree/library";
import pg from "pg";

import { buildCommand } from "../bins/build.js";

/** What uniqueProjectName() puts in every name; the only databases dropTestProjects() will drop. */
const TEST_TOKEN = /t-[0-9a-f]{8}/;

/** The server the tests run against. Throws when there is none. */
export function testServerUrl(): string {
  return required(
    "STORYTREE_TEST_PG_URL",
    "run the tests via `pnpm test`, which starts a local Postgres, or set STORYTREE_TEST_PG_URL to a server the tests may create and drop databases on",
  );
}

/** The test server's data directory, beside which its owner record is kept. Throws when there is none. */
export function testServerDataDir(): string {
  return required("STORYTREE_TEST_PG_DATA", "run the tests via `pnpm test`, which starts the test Postgres through @storytree/local-postgres");
}

/** A project name no other test, and no earlier run, is using: `t-` and 8 random hex digits. */
export function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

/**
 * Drop the libraries of these test projects, ending any connection still open to them. Only names
 * carrying a uniqueProjectName() token are accepted, so a mistake in a test can never drop
 * somebody's real database on a shared server. The database name is the library's rule, restated.
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
    for (const name of names) await client.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

/** The built command, once per test file: build it in `before`, remove it in `after`. */
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

  /** The folder it is built in. */
  get dir(): string {
    return path.dirname(this.script);
  }
}

/** What one run of the command did. */
export interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  /** How long it took, from starting Node to its exit, in milliseconds. */
  ms: number;
}

/** Assert the command's exit status, retaining its output when it fails. */
export function assertExitCode(ran: Pick<Ran, "code" | "stdout" | "stderr">, expected: number, context = "built command"): void {
  assert.equal(ran.code, expected, `${context}\nstderr:\n${ran.stderr}\nstdout:\n${ran.stdout}`);
}

export interface RunOptions {
  /** The folder it runs in. */
  readonly cwd: string;
  /** The storytree home it is given, as STORYTREE_HOME. */
  readonly home: string;
  /** More of the environment, over the test's own. */
  readonly env?: Readonly<Record<string, string>>;
  /** What it reads on standard input; none when not given. */
  readonly input?: string;
}

/** Run the built command as a shell runs it: directly, no shell, in `cwd`, with the storytree home given. */
export function storytree(script: string, args: readonly string[], options: RunOptions): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    // A variable given replaces the test's own of the same name in any case (Windows spells PATH `Path`).
    // The shell running the tests may itself belong to an agent; each world starts as a person.
    const given = { CLAUDE_CODE_SESSION_ID: "", CODEX_THREAD_ID: "", ...options.env, STORYTREE_HOME: options.home };
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
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: performance.now() - started }));
  });
}

/** How long a bare Node that does nothing takes to start and exit: the machine's floor. */
export function bareNode(): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore", shell: false });
    child.on("error", reject);
    child.on("exit", () => resolve(performance.now() - started));
  });
}

/** One test's world: a project folder, a folder that is none, and a storytree home, all thrown away after. */
export interface World {
  /** The project's name. */
  readonly project: string;
  /** A folder set up as the project. */
  readonly folder: string;
  /** A folder nobody has set up. */
  readonly elsewhere: string;
  /** A storytree home where storytree is running (the test server). */
  readonly home: string;
  /** A storytree home where it is not. */
  readonly stoppedHome: string;
  /** Run the command in the project folder, storytree running. */
  run(args: readonly string[], env?: Readonly<Record<string, string>>): Promise<Ran>;
  /** The project's library, opened directly, as the test's own view of it. */
  library(): Promise<Library>;
}

/** Run `body` in a fresh world for `command`, and throw it all away afterwards, pass or fail. */
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
    writeFileSync(path.join(folder, ".storytree.json"), `${JSON.stringify({ project })}\n`);
    copyFileSync(`${testServerDataDir()}.owner.json`, path.join(home, "pgdata.owner.json"));
    // The folder names a project that is set up: a folder never makes its project by being opened.
    const opened: Promise<Library> = storytreeServer.openProject(project);
    await opened;
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
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function required(name: string, how: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set: ${how}.`);
  return value;
}
