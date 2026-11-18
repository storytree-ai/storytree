// Capability 2 · Settings
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { storytreeHome } from "../routing/index.js";

export type SettingGroup = "sessions" | "library" | "machine";

const contextGuidance = {
  name: "context-guidance",
  group: "sessions",
  type: "positive whole number",
  unit: "tokens",
  default: 600_000,
  meaning: "Soft guidance for context size in tokens; it does not enforce a hard limit.",
} as const;

const idleAfter = {
  name: "idle-after",
  group: "sessions",
  label: "Time before a quiet claim can be taken over",
  type: "duration",
  unit: "",
  default: "30m",
  meaning: "Another session may take over a claim whose holder has had no activity and no command running for this time; a session whose hooks do not report its turns also reads as waiting after it. Use whole seconds (s), minutes (m), hours (h) or days (d), such as 10m. Default: 30 minutes.",
} as const;

const leaveAfter = {
  name: "leave-after",
  group: "sessions",
  label: "Time before a finished session leaves the list",
  type: "duration",
  unit: "",
  default: "1h",
  meaning: "A session that holds no unmerged work and has not closed out leaves the running-sessions list once it has been quiet this long, counted from its last activity or from when its work was merged, whichever is later; a session the Claude or Codex app keeps shows as done until you archive it there instead. Use whole seconds (s), minutes (m), hours (h) or days (d), such as 2h. Default: 1 hour.",
} as const;

const healthMemory = {
  name: "health-memory",
  group: "machine",
  label: "Memory available below which this machine is a concern",
  type: "positive whole number",
  unit: "GB",
  default: 6,
  meaning: "`storytree machine health` reports a concern when this machine has less memory available than this, in gigabytes. Default: 6 GB.",
} as const;

const healthLoad = {
  name: "health-load",
  group: "machine",
  label: "Load above which this machine is a concern",
  type: "positive whole number",
  unit: "",
  default: 12,
  meaning: "`storytree machine health` reports a concern when this machine's 15-minute load (Linux) or processor queue (Windows) is over this. Default: 12.",
} as const;

const healthDisk = {
  name: "health-disk",
  group: "machine",
  label: "How full the system disk may be before it is a concern",
  type: "percentage",
  unit: "%",
  default: 85,
  meaning: "`storytree machine health` reports a concern when this machine's system disk is fuller than this, in percent, a whole number from 1 to 100. Default: 85%.",
} as const;

const HEALTH = [healthMemory, healthLoad, healthDisk] as const;
type HealthName = (typeof HEALTH)[number]["name"];

const library = {
  name: "library",
  group: "library",
  label: "Where the library lives",
  default: "local",
  meaning:
    "Where the library lives: `local`, the storytree app's own database on this computer; " +
    "or `postgres`, any Postgres reached by its address (postgres://user@host:port/database, or wss://user@host/database over HTTPS), its password saved as the key `postgres` with `storytree auth set postgres`.",
} as const;

interface ContextGuidanceReading {
  readonly name: "context-guidance";
  readonly group: "sessions";
  readonly type: "positive whole number";
  readonly unit: "tokens";
  readonly default: number;
  readonly meaning: string;
  readonly value: number;
  readonly source: "default" | "set";
}

interface IdleReading {
  readonly name: "idle-after" | "leave-after";
  readonly group: "sessions";
  readonly label: string;
  readonly type: "duration";
  readonly unit: "";
  readonly default: string;
  readonly meaning: string;
  readonly value: string;
  readonly source: "default" | "set";
}

interface HealthReading {
  readonly name: HealthName;
  readonly group: "machine";
  readonly label: string;
  readonly type: "positive whole number" | "percentage";
  readonly unit: string;
  readonly default: number;
  readonly meaning: string;
  readonly value: number;
  readonly source: "default" | "set";
}

export type SettingReading = ContextGuidanceReading | IdleReading | HealthReading;

export type LibraryLocation =
  | { readonly location: "local" }
  | { readonly location: "postgres"; readonly address: string };

export type LibraryReading = LibraryLocation & {
  readonly name: "library";
  readonly group: "library";
  readonly label: string;
  readonly default: "local";
  readonly meaning: string;
  readonly source: "default" | "set";
};

export interface SettingsReading {
  readonly "context-guidance": ContextGuidanceReading;
  readonly "idle-after": IdleReading;
  readonly "leave-after": IdleReading;
  readonly "health-memory": HealthReading;
  readonly "health-load": HealthReading;
  readonly "health-disk": HealthReading;
  readonly library: LibraryReading;
}

export type SurfaceChoices = Readonly<Record<string, Readonly<Record<string, boolean | string>>>>;

interface Stored {
  "context-guidance"?: number;
  "idle-after"?: string;
  "leave-after"?: string;
  "health-memory"?: number;
  "health-load"?: number;
  "health-disk"?: number;
  library?: LibraryLocation;
  surfaces?: SurfaceChoices;
  experiment?: ExperimentArm;
  "modules-off"?: readonly string[];
  "parts-off"?: readonly string[];
  factory?: string;
  "factory-switched"?: FactorySwitched;
  "stand-ins"?: Readonly<Record<string, string>>;
  "stand-ins-switched"?: Readonly<Record<string, FactorySwitched>>;
  "stand-ins-history"?: Readonly<Record<string, readonly StandInSwitchedBack[]>>;
  "system-off"?: readonly string[];
  "system-on"?: readonly string[];
  "setup-approvals"?: Readonly<Record<string, SetupApproval>>;
  "services-on"?: readonly string[];
}

export interface SystemSwitches {
  readonly off: readonly string[];
  readonly on: readonly string[];
}

export interface ExperimentArm {
  readonly name: string;
  readonly arm: string;
  readonly denies?: { readonly tools: readonly string[]; readonly commands: readonly string[] };
}

export function readSettings(home: string = storytreeHome()): SettingsReading {
  const stored = readStored(home);
  const guidance = stored["context-guidance"];
  return {
    "context-guidance": {
      ...contextGuidance,
      value: guidance ?? contextGuidance.default,
      source: guidance === undefined ? "default" : "set",
    },
    "idle-after": {
      ...idleAfter,
      value: stored["idle-after"] ?? idleAfter.default,
      source: stored["idle-after"] === undefined ? "default" : "set",
    },
    "leave-after": {
      ...leaveAfter,
      value: stored["leave-after"] ?? leaveAfter.default,
      source: stored["leave-after"] === undefined ? "default" : "set",
    },
    ...healthReadings(stored),
    library: { ...library, ...(stored.library ?? { location: "local" }), source: stored.library === undefined ? "default" : "set" },
  };
}

function healthReadings(stored: Stored): Pick<SettingsReading, HealthName> {
  const reading = (declared: (typeof HEALTH)[number]): HealthReading => ({
    ...declared,
    value: stored[declared.name] ?? declared.default,
    source: stored[declared.name] === undefined ? "default" : "set",
  });
  return { "health-memory": reading(healthMemory), "health-load": reading(healthLoad), "health-disk": reading(healthDisk) };
}

export function readLibrary(home: string = storytreeHome()): LibraryLocation {
  const file = path.join(home, "settings.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && lstatSync(file, { throwIfNoEntry: false }) === undefined) return { location: "local" };
    throw new Error(`Cannot read settings file "${file}": ${(error as Error).message}`, { cause: error });
  }
  try {
    const stored: unknown = JSON.parse(text);
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) throw new Error("expected a JSON object of setting names and values");
    const value = (stored as Record<string, unknown>)[library.name];
    return value === undefined ? { location: "local" } : checkedLibrary(value);
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before storytree can say where the library is.`, { cause: error });
  }
}

export function readExperiment(home: string = storytreeHome()): ExperimentArm | undefined {
  const file = path.join(home, "settings.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && lstatSync(file, { throwIfNoEntry: false }) === undefined) return undefined;
    throw new Error(`Cannot read settings file "${file}": ${(error as Error).message}`, { cause: error });
  }
  try {
    const stored: unknown = JSON.parse(text);
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) throw new Error("expected a JSON object of setting names and values");
    const value = (stored as Record<string, unknown>).experiment;
    return value === undefined ? undefined : checkedExperiment(value);
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before storytree can say which experiment arm this home runs.`, { cause: error });
  }
}

export function readPartsOff(home: string = storytreeHome()): readonly string[] {
  const file = path.join(home, "settings.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && lstatSync(file, { throwIfNoEntry: false }) === undefined) return [];
    throw new Error(`Cannot read settings file "${file}": ${(error as Error).message}`, { cause: error });
  }
  try {
    const stored: unknown = JSON.parse(text);
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) throw new Error("expected a JSON object of setting names and values");
    const named = stored as Record<string, unknown>;
    const old = named[PARTS_OFF] === undefined ? undefined : checkedPartsOff(named[PARTS_OFF], PARTS_OFF);
    return named[MODULES_OFF] === undefined ? old ?? [] : checkedPartsOff(named[MODULES_OFF], MODULES_OFF);
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before storytree can say which modules are switched off.`, { cause: error });
  }
}

const DEFAULT_FACTORY = "your-factory";

export function factoryFolder(home: string = storytreeHome()): { readonly folder: string; readonly chosen: boolean; readonly switched?: FactorySwitched } {
  const forRun = process.env.STORYTREE_FACTORY;
  if (forRun !== undefined && forRun !== "") return { folder: path.resolve(forRun), chosen: true };
  const stored = readStored(home);
  const chosen = stored.factory;
  if (chosen !== undefined) return { folder: chosen, chosen: true, ...(stored[FACTORY_SWITCHED] === undefined ? {} : { switched: stored[FACTORY_SWITCHED] }) };
  const full = path.resolve(home);
  return { folder: path.join(path.basename(path.dirname(full)) === ".storytree" ? path.dirname(full) : full, DEFAULT_FACTORY), chosen: false };
}

export function makeFactoryFolder(home: string = storytreeHome()): { readonly folder: string; readonly chosen: boolean } {
  const factory = factoryFolder(home);
  if (!factory.chosen) mkdirSync(path.join(factory.folder, "plugins"), { recursive: true });
  return factory;
}

export function readStandIns(home: string = storytreeHome()): {
  readonly folder: string;
  readonly plugins: Readonly<Record<string, string>>;
  readonly switched: Readonly<Record<string, FactorySwitched>>;
  readonly history: Readonly<Record<string, readonly StandInSwitchedBack[]>>;
} {
  const stored = readStored(home);
  return { folder: factoryFolder(home).folder, plugins: stored[STAND_INS] ?? {}, switched: stored[STAND_INS_SWITCHED] ?? {}, history: stored[STAND_INS_HISTORY] ?? {} };
}

export type FactorySwitcher = { readonly through: "desktop app" | "command line" | "agent tool"; readonly session?: string };

export type FactorySwitched = FactorySwitcher & { readonly at: string };

export interface StandInSwitchedBack {
  readonly plugin: string;
  readonly in?: FactorySwitched;
  readonly back: FactorySwitched;
}

export interface ChosenFactory {
  readonly status: "set up" | "already a factory";
  readonly folder: string;
}

export function setFactory(folder: string, home: string = storytreeHome(), by: FactorySwitcher = { through: "command line" }, now: Date = new Date()): ChosenFactory {
  const full = path.resolve(folder);
  if (!statSync(full, { throwIfNoEntry: false })?.isDirectory()) refuse(`There is no folder at ${full}; make it first, or choose another.`);
  const plugins = path.join(full, "plugins");
  let status: ChosenFactory["status"] = "already a factory";
  if (!statSync(plugins, { throwIfNoEntry: false })?.isDirectory()) {
    if (readdirSync(full).some((entry) => !entry.startsWith("."))) {
      refuse(`${full} holds other files and no plugins folder, so it is not a factory; choose an empty folder for storytree to set up, or one it set up before.`);
    }
    mkdirSync(plugins);
    status = "set up";
  }
  write(home, { ...readStored(home), factory: full, [FACTORY_SWITCHED]: { ...by, at: now.toISOString() } });
  return { status, folder: full };
}

export function readSystemSwitches(home: string = storytreeHome()): SystemSwitches {
  const file = path.join(home, "settings.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && lstatSync(file, { throwIfNoEntry: false }) === undefined) return { off: [], on: [] };
    throw new Error(`Cannot read settings file "${file}": ${(error as Error).message}`, { cause: error });
  }
  try {
    const stored: unknown = JSON.parse(text);
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) throw new Error("expected a JSON object of setting names and values");
    return checkedSystem(stored as Record<string, unknown>);
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before storytree can say which of its system is switched off.`, { cause: error });
  }
}

export function setSystemSwitch(name: string, off: boolean, home: string = storytreeHome()): SystemSwitches {
  const stored = readStored(home);
  const without = (names: readonly string[] | undefined) => (names ?? []).filter((one) => one !== name);
  const switches = off
    ? { off: [...without(stored[SYSTEM_OFF]), name].sort(), on: without(stored[SYSTEM_ON]) }
    : { off: without(stored[SYSTEM_OFF]), on: name === "all" ? without(stored[SYSTEM_ON]) : [...without(stored[SYSTEM_ON]), name].sort() };
  write(home, { ...stored, [SYSTEM_OFF]: switches.off, [SYSTEM_ON]: switches.on });
  return switches;
}

export function setPartOff(part: string, off: boolean, home: string = storytreeHome(), plugin?: string, by: FactorySwitcher = { through: "command line" }, now: Date = new Date()): readonly string[] {
  if (CORE.includes(part)) refuse(`${part} is the core, which every host stands on, so it is never switched off.`);
  const stored = readStored(home);
  const rest = (stored[MODULES_OFF] ?? stored[PARTS_OFF] ?? []).filter((one) => one !== part);
  const parts = off ? [...rest, part].sort() : rest;
  const { [part]: _dropped, ...standIns } = stored[STAND_INS] ?? {};
  const named = off && plugin !== undefined ? { ...standIns, [part]: plugin } : standIns;
  const { [part]: _unrecorded, ...records } = stored[STAND_INS_SWITCHED] ?? {};
  const recorded = off && plugin !== undefined ? { ...records, [part]: { ...by, at: now.toISOString() } } : records;
  const was = stored[STAND_INS]?.[part];
  const inRecord = stored[STAND_INS_SWITCHED]?.[part];
  const history = stored[STAND_INS_HISTORY] ?? {};
  const backed = was === undefined ? history : { ...history, [part]: [...(history[part] ?? []), { plugin: was, ...(inRecord === undefined ? {} : { in: inRecord }), back: { ...by, at: now.toISOString() } }] };
  write(home, {
    ...stored,
    [MODULES_OFF]: parts,
    ...(stored[PARTS_OFF] === undefined ? {} : { [PARTS_OFF]: parts }),
    ...(stored[STAND_INS] === undefined && plugin === undefined ? {} : { [STAND_INS]: named }),
    ...(stored[STAND_INS_SWITCHED] === undefined && plugin === undefined ? {} : { [STAND_INS_SWITCHED]: recorded }),
    ...(was === undefined ? {} : { [STAND_INS_HISTORY]: backed }),
  });
  return parts;
}

export function readServicesOn(home: string = storytreeHome()): readonly string[] {
  return readStored(home)[SERVICES_ON] ?? [];
}

export function setServiceOn(service: string, on: boolean, home: string = storytreeHome()): readonly string[] {
  checkedServicesOn([service]);
  const stored = readStored(home);
  const rest = (stored[SERVICES_ON] ?? []).filter((one) => one !== service);
  const services = on ? [...rest, service].sort() : rest;
  write(home, { ...stored, [SERVICES_ON]: services });
  return services;
}

export interface SetupApproval {
  readonly fingerprint: string;
  readonly at: string;
}

export function readSetupApproval(repository: string, home: string = storytreeHome()): SetupApproval | undefined {
  return readStored(home)[SETUP_APPROVALS]?.[repository];
}

export function setSetupApproval(repository: string, fingerprint: string, home: string = storytreeHome(), now: Date = new Date()): SetupApproval {
  const stored = readStored(home);
  const approval = { fingerprint, at: now.toISOString() };
  write(home, { ...stored, [SETUP_APPROVALS]: { ...stored[SETUP_APPROVALS], [repository]: approval } });
  return approval;
}

export function setSetting(name: string, value: string, home: string = storytreeHome()): SettingReading {
  checkName(name);
  if (name === library.name) return refuse("Set the library with `storytree settings set library local` or `… library postgres <address>`.");
  if (name === idleAfter.name || name === leaveAfter.name) {
    checkedDuration(value, name);
    write(home, { ...readStored(home), [name]: value });
    return readSettings(home)[name];
  }
  if (isHealth(name)) {
    write(home, { ...readStored(home), [name]: checkedHealth(/^\d+$/.test(value) ? Number(value) : NaN, name) });
    return readSettings(home)[name];
  }
  const number = checkedGuidance(/^\d+$/.test(value) ? Number(value) : NaN);
  write(home, { ...readStored(home), [name]: number });
  return readSettings(home)["context-guidance"];
}

export function setLibrary(words: readonly string[], home: string = storytreeHome()): LibraryReading {
  const given = words[0] === "postgres" ? { location: "postgres", address: words[1] } : { location: words[0] };
  const location = checkedLibrary(given, words.length);
  write(home, { ...readStored(home), library: location });
  return readSettings(home).library;
}

export function readSurfaceChoices(home: string = storytreeHome()): SurfaceChoices {
  return readStored(home).surfaces ?? {};
}

export function setSurfaceChoice(surface: string, key: string, value: boolean | string, home: string = storytreeHome()): SurfaceChoices {
  const stored = readStored(home);
  const surfaces = { ...stored.surfaces, [surface]: { ...stored.surfaces?.[surface], [key]: value } };
  write(home, { ...stored, surfaces: checkedSurfaces(surfaces) });
  return surfaces;
}

function write(home: string, stored: Stored): void {
  mkdirSync(home, { recursive: true });
  const file = path.join(home, "settings.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function refuse(message: string): never {
  throw new Error(message);
}

function checkName(name: string): asserts name is "context-guidance" | "idle-after" | "leave-after" | HealthName | "library" {
  if (name !== contextGuidance.name && name !== idleAfter.name && name !== leaveAfter.name && !isHealth(name) && name !== library.name) {
    const names = [contextGuidance.name, idleAfter.name, leaveAfter.name, ...HEALTH.map((declared) => declared.name), library.name];
    refuse(`Unknown setting ${JSON.stringify(name)}. Available settings: ${names.join(", ")}.`);
  }
}

function isHealth(name: string): name is HealthName {
  return HEALTH.some((declared) => declared.name === name);
}

function checkedHealth(value: unknown, name: HealthName): number {
  const most = name === healthDisk.name ? 100 : Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > most) {
    refuse(name === healthDisk.name ? `${name} must be a whole number of percent from 1 to 100.` : `${name} must be a positive whole number.`);
  }
  return value;
}

export function idleAfterMs(home?: string): number {
  return checkedDuration(readSettings(home)["idle-after"].value);
}

export function leaveAfterMs(home?: string): number {
  return checkedDuration(readSettings(home)["leave-after"].value, leaveAfter.name);
}

function checkedDuration(value: unknown, name: string = idleAfter.name): number {
  const match = typeof value === "string" ? /^(\d+)(s|m|h|d)$/.exec(value) : null;
  const units: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ms = match === null ? NaN : Number(match[1]) * units[match[2]!]!;
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    refuse(`${name} must be a positive duration in whole seconds (s), minutes (m), hours (h) or days (d), such as 10m, within the safe millisecond range.`);
  }
  return ms;
}

function checkedGuidance(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    refuse(`${contextGuidance.name} must be a positive whole number of tokens (at most ${Number.MAX_SAFE_INTEGER}).`);
  }
  return value;
}

const NO_CLOUD_SQL =
  "library: Cloud SQL is no longer built into storytree. Reach the instance as a Postgres address instead: through the Cloud SQL Auth Proxy, " +
  "or its public IP, as an ordinary database user, with `storytree settings set library postgres postgres://<user>@<host>[:<port>]/postgres` " +
  "and its password saved with `storytree auth set postgres`.";

function checkedLibrary(value: unknown, words?: number): LibraryLocation {
  const usage =
    "library is `local`, or `postgres <address>`: postgres://<user>@<host>[:<port>]/<database> or wss://<user>@<host>[:<port>]/<database>.";
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse(usage);
  const { location, address, ...rest } = value as { location?: unknown; address?: unknown };
  if (location === "cloudsql") return refuse(NO_CLOUD_SQL);
  if (Object.keys(rest).length > 0) return refuse(usage);
  if (location === "local" && address === undefined && (words ?? 1) === 1) return { location };
  if (location === "postgres" && (words ?? 2) === 2) return { location, address: checkedAddress(address) };
  return refuse(usage);
}

function checkedAddress(address: unknown): string {
  const usage =
    "library: a Postgres address is written postgres://<user>@<host>[:<port>]/<database>, with ?sslmode=… where the server needs it, " +
    "or wss://<user>@<host>[:<port>]/<database> for one reached over HTTPS.";
  if (typeof address !== "string") return refuse(usage);
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return refuse(usage);
  }
  if (url.password !== "") {
    return refuse("library: the address carries a password. Take it out of the address and save it as a key instead: `storytree auth set postgres`.");
  }
  if (!/^(postgres(ql)?|wss):$/.test(url.protocol) || url.hostname === "" || url.username === "") return refuse(usage);
  return address;
}

function checkedExperiment(value: unknown): ExperimentArm {
  const usage = "experiment must name the experiment and the arm this home runs, and at most what that arm denies, by door: {\"name\": \"<experiment>\", \"arm\": \"<arm>\", \"denies\": {\"tools\": [...], \"commands\": [...]}}.";
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse(usage);
  const { name, arm, denies, ...rest } = value as { name?: unknown; arm?: unknown; denies?: unknown };
  if (Object.keys(rest).length > 0 || typeof name !== "string" || name === "" || typeof arm !== "string" || arm === "") return refuse(usage);
  if (denies === undefined) return { name, arm };
  const names = (list: unknown): list is string[] => Array.isArray(list) && list.every((one) => typeof one === "string" && one !== "");
  if (denies === null || typeof denies !== "object" || Array.isArray(denies)) return refuse(usage);
  const { tools, commands, ...more } = denies as { tools?: unknown; commands?: unknown };
  if (Object.keys(more).length > 0 || !names(tools) || !names(commands)) return refuse(usage);
  return { name, arm, denies: { tools, commands } };
}

const MODULES_OFF = "modules-off";
const PARTS_OFF = "parts-off";

export const CORE: readonly string[] = ["library", "plugin-loader", "project-and-caller"];

function checkedPartsOff(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((one) => typeof one === "string" && one !== "")) refuse(`${key} must list the names of the modules switched off, such as ["forest"].`);
  return [...new Set(value as string[])].sort();
}

const STAND_INS = "stand-ins";
const FACTORY_SWITCHED = "factory-switched";
const STAND_INS_SWITCHED = "stand-ins-switched";
const STAND_INS_HISTORY = "stand-ins-history";
const SWITCHERS: readonly string[] = ["desktop app", "command line", "agent tool"];

function isSwitched(value: unknown): value is FactorySwitched {
  const one = value as Record<string, unknown> | null;
  return one !== null && typeof one === "object" && !Array.isArray(one) && SWITCHERS.includes(one.through as string) && typeof one.at === "string" && !Number.isNaN(Date.parse(one.at)) && (one.session === undefined || typeof one.session === "string");
}

function checkedSwitched(value: unknown): FactorySwitched {
  if (!isSwitched(value)) refuse(`${FACTORY_SWITCHED} must say who switched the factory folder and when, such as {"through": "desktop app", "at": "2026-10-23T05:00:00.000Z"}.`);
  return value;
}

function checkedStandInsSwitched(value: unknown): Readonly<Record<string, FactorySwitched>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every(isSwitched)) {
    refuse(`${STAND_INS_SWITCHED} must say, for each part a factory plugin stands in for, who switched it and when, such as {"ci-health": {"through": "command line", "at": "2026-10-23T05:00:00.000Z"}}.`);
  }
  return value as Readonly<Record<string, FactorySwitched>>;
}

function checkedStandInsHistory(value: unknown): Readonly<Record<string, readonly StandInSwitchedBack[]>> {
  const entry = (one: unknown) => {
    const given = one as Record<string, unknown> | null;
    return given !== null && typeof given === "object" && !Array.isArray(given) && typeof given.plugin === "string" && given.plugin !== ""
      && (given.in === undefined || isSwitched(given.in)) && isSwitched(given.back);
  };
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every((list) => Array.isArray(list) && list.every(entry))) {
    refuse(`${STAND_INS_HISTORY} must list, for each part a factory plugin stood in for, the plugin, who switched it in and who switched it back, each with when, such as {"ci-health": [{"plugin": "my-health", "in": {"through": "command line", "at": "2026-10-23T05:00:00.000Z"}, "back": {"through": "desktop app", "at": "2026-10-23T06:00:00.000Z"}}]}.`);
  }
  return value as Readonly<Record<string, readonly StandInSwitchedBack[]>>;
}

function checkedStandIns(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every((one) => typeof one === "string" && one !== "")) {
    refuse(`${STAND_INS} must map each switched-off part to the factory plugin standing in for it, such as {"ci-health": "my-health"}.`);
  }
  return value as Record<string, string>;
}

const SETUP_APPROVALS = "setup-approvals";

function checkedSetupApprovals(value: unknown): Readonly<Record<string, SetupApproval>> {
  const approval = (one: unknown) => {
    const given = one as Record<string, unknown> | null;
    return given !== null && typeof given === "object" && !Array.isArray(given) && typeof given.fingerprint === "string" && given.fingerprint !== ""
      && typeof given.at === "string" && !Number.isNaN(Date.parse(given.at)) && Object.keys(given).length === 2;
  };
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every(approval)) {
    refuse(`${SETUP_APPROVALS} must map each repository's main checkout to the fingerprint of the checked-in setup commands its user approved and when, such as {"/work/site": {"fingerprint": "0123456789abcdef", "at": "2026-10-25T09:00:00.000Z"}}.`);
  }
  return value as Readonly<Record<string, SetupApproval>>;
}

const SERVICES_ON = "services-on";

export const SERVICE_NAME = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

function checkedServicesOn(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((one) => typeof one === "string" && SERVICE_NAME.test(one))) {
    refuse(`${SERVICES_ON} must list the services turned on, each named <part>/<service>, such as ["voice/listen"].`);
  }
  return [...new Set(value as string[])].sort();
}

const SYSTEM_OFF = "system-off";
const SYSTEM_ON = "system-on";

function checkedSystemNames(name: string, value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((one) => typeof one === "string" && one !== "")) {
    refuse(`${name} must list names: all, roles, checks, notes, or a role's, check's or note's title or id, such as ["roles"].`);
  }
  return [...new Set(value as string[])].sort();
}

function checkedSystem(stored: Record<string, unknown>): SystemSwitches {
  const switches = { off: checkedSystemNames(SYSTEM_OFF, stored[SYSTEM_OFF]), on: checkedSystemNames(SYSTEM_ON, stored[SYSTEM_ON]) };
  const both = switches.off.filter((name) => switches.on.includes(name));
  if (both.length > 0) refuse(`${both.join(", ")} ${both.length === 1 ? "is" : "are"} in both ${SYSTEM_OFF} and ${SYSTEM_ON}; name each in one.`);
  return switches;
}

function checkedSurfaces(value: unknown): SurfaceChoices {
  const usage = "surfaces must map each surface's id to its choices: `on` true or false, and each setting's id to the text of its choice.";
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse(usage);
  for (const choices of Object.values(value)) {
    if (choices === null || typeof choices !== "object" || Array.isArray(choices)) return refuse(usage);
    for (const [key, choice] of Object.entries(choices)) {
      if (key === "on" ? typeof choice !== "boolean" : typeof choice !== "string") return refuse(usage);
    }
  }
  return value as SurfaceChoices;
}

function readStored(home: string): Stored {
  const file = path.join(home, "settings.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && lstatSync(file, { throwIfNoEntry: false }) === undefined) return {};
    throw new Error(`Cannot read settings file "${file}": ${(error as Error).message}`, { cause: error });
  }
  try {
    const stored: unknown = JSON.parse(text);
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
      throw new Error("expected a JSON object of setting names and values");
    }
    const settings: Stored = {};
    for (const [name, value] of Object.entries(stored)) {
      if (name === "surfaces") {
        settings.surfaces = checkedSurfaces(value);
        continue;
      }
      if (name === "experiment") {
        settings.experiment = checkedExperiment(value);
        continue;
      }
      if (name === MODULES_OFF || name === PARTS_OFF) {
        settings[name] = checkedPartsOff(value, name);
        continue;
      }
      if (name === "factory") {
        if (typeof value !== "string" || !path.isAbsolute(value)) refuse("factory must be the full path of this computer's factory folder.");
        settings.factory = value as string;
        continue;
      }
      if (name === FACTORY_SWITCHED) {
        settings[FACTORY_SWITCHED] = checkedSwitched(value);
        continue;
      }
      if (name === STAND_INS_SWITCHED) {
        settings[STAND_INS_SWITCHED] = checkedStandInsSwitched(value);
        continue;
      }
      if (name === STAND_INS_HISTORY) {
        settings[STAND_INS_HISTORY] = checkedStandInsHistory(value);
        continue;
      }
      if (name === STAND_INS) {
        settings[STAND_INS] = checkedStandIns(value);
        continue;
      }
      if (name === SETUP_APPROVALS) {
        settings[SETUP_APPROVALS] = checkedSetupApprovals(value);
        continue;
      }
      if (name === SERVICES_ON) {
        settings[SERVICES_ON] = checkedServicesOn(value);
        continue;
      }
      if (name === SYSTEM_OFF || name === SYSTEM_ON) {
        settings[name] = checkedSystem(stored as Record<string, unknown>)[name === SYSTEM_OFF ? "off" : "on"];
        continue;
      }
      checkName(name);
      if (name === "library") settings.library = checkedLibrary(value);
      else if (name === "idle-after" || name === "leave-after") {
        checkedDuration(value, name);
        settings[name] = value as string;
      }
      else if (isHealth(name)) settings[name] = checkedHealth(value, name);
      else settings[name] = checkedGuidance(value);
    }
    return settings;
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before reading or changing settings.`, { cause: error });
  }
}
