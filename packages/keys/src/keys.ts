// Capability 1 · Key store and resolver
import { execSync } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface StoreOptions {
  readonly home?: string;
}

export interface ResolveOptions extends StoreOptions {
  readonly explicit?: string;
  readonly variable?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export type KeySource = "file" | "command" | "environment";

export interface KeyReading {
  readonly name: string;
  readonly from: KeySource;
  readonly variable?: string;
}

const VARIABLES: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  github: "GH_TOKEN",
  postgres: "PGPASSWORD",
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function authFile(options: StoreOptions = {}): string {
  return path.join(options.home ?? defaultHome(), "auth.json");
}

export function saveKey(name: string, value: string, options: StoreOptions = {}): void {
  checkName(name);
  if (value === "") throw new Error(`The key ${name} has no value: give the key, or !<command> to run for it.`);
  update(options, (entries) => ({ ...entries, [name]: { key: value } }));
}

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

export function listKeys(options: StoreOptions & { readonly env?: NodeJS.ProcessEnv } = {}): KeyReading[] {
  const env = options.env ?? process.env;
  const saved = read(authFile(options));
  const readings: KeyReading[] = Object.entries(saved).map(([name, entry]) => ({ name, from: entry.key.startsWith("!") ? "command" : "file" }));
  for (const [name, variable] of Object.entries(VARIABLES)) {
    if (!Object.hasOwn(saved, name) && nonEmpty(env[variable]) !== undefined) readings.push({ name, from: "environment", variable });
  }
  return readings.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveKey(name: string, options: ResolveOptions = {}): string | undefined {
  checkName(name);
  const explicit = nonEmpty(options.explicit);
  if (explicit !== undefined) return explicit;
  const saved = read(authFile(options))[name];
  if (saved !== undefined) return saved.key.startsWith("!") ? run(name, saved.key.slice(1)) : saved.key;
  return nonEmpty((options.env ?? process.env)[options.variable ?? variableOf(name)]);
}

const COULD_NOT_CONNECT = /could not resolve hostname|name or service not known|nodename nor servname|no such host is known|temporary failure in name resolution|network is unreachable|no route to host|connection timed out|operation timed out|connection refused/i;

export class KeyCommandError extends Error {
  constructor(message: string, readonly unreachable: boolean) {
    super(message);
    this.name = "KeyCommandError";
  }
}

const ran = new Map<string, string>();

function run(name: string, command: string): string {
  const done = ran.get(command);
  if (done !== undefined) return done;
  let printed: string;
  try {
    printed = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  } catch (error) {
    const { status, stderr } = error as { status?: number | null; stderr?: unknown };
    throw new KeyCommandError(
      `The command saved for key ${name} failed${typeof status === "number" ? ` (exit ${status})` : ""}: run it yourself to see why, or save the key again with \`storytree auth set ${name}\`.`,
      typeof stderr === "string" && COULD_NOT_CONNECT.test(stderr),
    );
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

const STALE_MS = 10_000;
const WAIT_MS = 15_000;

export interface LockOptions {
  readonly open?: (lock: string) => void;
  readonly waitMs?: number;
  readonly now?: () => number;
  readonly pause?: (ms: number) => void;
}

export function withLock(lock: string, body: () => void, { open = openLock, waitMs = WAIT_MS, now = Date.now, pause = sleep }: LockOptions = {}): void {
  const started = now();
  for (;;) {
    try {
      open(lock);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw error;
      if (code === "EEXIST" && stale(lock)) {
        rmSync(lock, { force: true });
        continue;
      }
      if (now() - started > waitMs) throw new Error(`The keys file is locked by another storytree process (${lock}): try again, or delete the lock if nothing is running.`);
      pause(10 + Math.random() * 20);
    }
  }
  try {
    body();
  } finally {
    rmSync(lock, { force: true });
  }
}

function openLock(lock: string): void {
  closeSync(openSync(lock, "wx"));
}

function stale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_MS;
  } catch {
    return false;
  }
}

function retrying(act: () => void): void {
  for (let attempt = 0; ; attempt++) {
    try {
      return act();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 50 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
      sleep(20);
    }
  }
}

function sleep(ms: number): void {
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

function defaultHome(): string {
  const home = process.env.STORYTREE_HOME;
  return home !== undefined && home !== "" ? path.resolve(home) : path.join(homedir(), ".storytree", "0.3");
}
