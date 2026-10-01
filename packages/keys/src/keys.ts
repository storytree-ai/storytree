/**
 * The key store and its resolver (ADR-0843), pi's shape: one `auth.json` in storytree's home, one
 * entry per name, readable and writable by the user alone, written under a lock by write-then-rename
 * so the app, the command line and the MCP server share it safely. A key resolves from an explicit
 * value, then its saved entry, then its environment variable; an entry `!<command>` runs the
 * command once per process and uses what it prints, which is how a user brings their own store.
 */
import { execSync } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface StoreOptions {
  /** Storytree's home; by default STORYTREE_HOME, else ~/.storytree/0.3, where settings.json is. */
  readonly home?: string;
}

export interface ResolveOptions extends StoreOptions {
  /** A value given on the command: it beats everything else. */
  readonly explicit?: string;
  /** The environment variable to fall back on; by default the vendor's own name, else the key's name in capitals. */
  readonly variable?: string;
  /** The environment to read it from; by default this process's. */
  readonly env?: NodeJS.ProcessEnv;
}

/** Where a key resolves from: its saved value, its saved command, or its environment variable. */
export type KeySource = "file" | "command" | "environment";

export interface KeyReading {
  readonly name: string;
  readonly from: KeySource;
  /** The environment variable, when it resolves from one. */
  readonly variable?: string;
}

/** The vendors' own variable names for the keys storytree knows (ADR-0843 D3). */
const VARIABLES: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  github: "GH_TOKEN",
  postgres: "PGPASSWORD",
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The file keys are saved in. */
export function authFile(options: StoreOptions = {}): string {
  return path.join(options.home ?? defaultHome(), "auth.json");
}

/** Save `value` as key `name`, replacing any saved before. */
export function saveKey(name: string, value: string, options: StoreOptions = {}): void {
  checkName(name);
  if (value === "") throw new Error(`The key ${name} has no value: give the key, or !<command> to run for it.`);
  update(options, (entries) => ({ ...entries, [name]: { key: value } }));
}

/** Delete key `name`; whether there was one. */
export function removeKey(name: string, options: StoreOptions = {}): boolean {
  checkName(name);
  let had = false;
  update(options, (entries) => {
    had = Object.hasOwn(entries, name);
    const { [name]: _gone, ...kept } = entries;
    return kept;
  });
  return had;
}

/** Every key saved, and every key storytree knows whose variable is set: names only, never values. */
export function listKeys(options: StoreOptions & { readonly env?: NodeJS.ProcessEnv } = {}): KeyReading[] {
  const env = options.env ?? process.env;
  const saved = read(authFile(options));
  const readings: KeyReading[] = Object.entries(saved).map(([name, entry]) => ({ name, from: entry.key.startsWith("!") ? "command" : "file" }));
  for (const [name, variable] of Object.entries(VARIABLES)) {
    if (!Object.hasOwn(saved, name) && nonEmpty(env[variable]) !== undefined) readings.push({ name, from: "environment", variable });
  }
  return readings.sort((a, b) => a.name.localeCompare(b.name));
}

/** Key `name`: the explicit value, else its saved entry, else its environment variable; undefined when none has it. */
export function resolveKey(name: string, options: ResolveOptions = {}): string | undefined {
  checkName(name);
  const explicit = nonEmpty(options.explicit);
  if (explicit !== undefined) return explicit;
  const saved = read(authFile(options))[name];
  if (saved !== undefined) return saved.key.startsWith("!") ? run(name, saved.key.slice(1)) : saved.key;
  return nonEmpty((options.env ?? process.env)[options.variable ?? variableOf(name)]);
}

/** What each `!command` printed, by command: each runs once per process. */
const ran = new Map<string, string>();

function run(name: string, command: string): string {
  const done = ran.get(command);
  if (done !== undefined) return done;
  let printed: string;
  try {
    printed = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  } catch (error) {
    // Never the command's output: it may hold the secret, or part of it.
    const status = (error as { status?: number | null }).status;
    throw new Error(`The command saved for key ${name} failed${typeof status === "number" ? ` (exit ${status})` : ""}: run it yourself to see why, or save the key again with \`storytree auth set ${name}\`.`);
  }
  if (printed === "") throw new Error(`The command saved for key ${name} printed nothing: it must print the key.`);
  ran.set(command, printed);
  return printed;
}

type Entries = Record<string, { key: string }>;

function read(file: string): Entries {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    || !Object.values(parsed).every((entry) => typeof entry === "object" && entry !== null && typeof (entry as { key?: unknown }).key === "string")) {
    throw new Error(`Invalid keys file ${file}: each entry must be { "key": "<value or !command>" }.`);
  }
  return parsed as Entries;
}

/** Change the saved keys under the file's lock, writing a temporary file and renaming it over the old. */
function update(options: StoreOptions, change: (entries: Entries) => Entries): void {
  const file = authFile(options);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  withLock(`${file}.lock`, () => {
    const next = change(read(file));
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    try {
      retrying(() => renameSync(temporary, file));
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  });
}

/** How long a lock may be held before another writer takes it as left by a crashed one. */
const STALE_MS = 10_000;
const WAIT_MS = 15_000;

function withLock(lock: string, body: () => void): void {
  const started = Date.now();
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (stale(lock)) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() - started > WAIT_MS) throw new Error(`The keys file is locked by another storytree process (${lock}): try again, or delete the lock if nothing is running.`);
      pause(10 + Math.random() * 20);
    }
  }
  try {
    body();
  } finally {
    rmSync(lock, { force: true });
  }
}

function stale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_MS;
  } catch {
    return false;
  }
}

/** Windows refuses a rename over a file another process has open for a moment: try again briefly. */
function retrying(act: () => void): void {
  for (let attempt = 0; ; attempt++) {
    try {
      return act();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 50 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
      pause(20);
    }
  }
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error(`"${name}" is not a key name: use letters, digits, dots, dashes and underscores.`);
}

function variableOf(name: string): string {
  return VARIABLES[name] ?? name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** Storytree's home, as the agent link's routing reads it: STORYTREE_HOME, else ~/.storytree/0.3. */
function defaultHome(): string {
  const home = process.env.STORYTREE_HOME;
  return home !== undefined && home !== "" ? path.resolve(home) : path.join(homedir(), ".storytree", "0.3");
}
