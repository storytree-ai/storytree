/** Capability 2 · Settings: per-user settings, owned by Project and caller (ADR-0729, ADR-1025; the library's location, ADR-0734/0735). */
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { storytreeHome } from "../routing/index.js";

/** The gear menu tab a setting shows under (the settings view offers its rows by group). */
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

/** The limits `storytree machine health` reads this machine against (Session management's Machines): past one, it is a concern. */
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
    "Where the library lives: `local`, the storytree app's own database on this computer; `cloudsql`, " +
    "a Google Cloud SQL instance signed in to as your Google account (set with its connection name and the account's email); " +
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

/**
 * Where the library lives: this computer's app, a Cloud SQL instance and the account to sign in to
 * it as, or any Postgres by its address, a postgres:// URL without its password (ADR-0846 D1).
 */
export type LibraryLocation =
  | { readonly location: "local" }
  | { readonly location: "cloudsql"; readonly instance: string; readonly user: string }
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

/**
 * The app's surface choices (ADR-0750): per surface id, `on` and each setting's chosen value. The
 * Project and caller keeps them and checks their shape; each story declares what they mean.
 */
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
  "parts-off"?: readonly string[];
  factory?: string;
  "factory-switched"?: FactorySwitched;
  "stand-ins"?: Readonly<Record<string, string>>;
  "stand-ins-switched"?: Readonly<Record<string, FactorySwitched>>;
  "stand-ins-history"?: Readonly<Record<string, readonly StandInSwitchedBack[]>>;
  "system-off"?: readonly string[];
  "system-on"?: readonly string[];
  "setup-approvals"?: Readonly<Record<string, SetupApproval>>;
}

/**
 * The system switched off and on on this computer (ADR-1092 D2), each a sorted list of names: `all`, a group (`roles`,
 * `checks` or `notes`), or one record's title or id. The library reads a record's most specific mention (1.21).
 */
export interface SystemSwitches {
  readonly off: readonly string[];
  readonly on: readonly string[];
}

/**
 * The experiment and arm a lane runs in (ADR-1064 D2), as its storytree home's settings.json names them, with the verbs
 * that arm denies by door once its run has copied them from the experiment's record: what the Experiments story reads
 * for its verdict, and the labels the activity log stamps. Written by whoever makes the arm's home and runs it.
 */
export interface ExperimentArm {
  readonly name: string;
  readonly arm: string;
  readonly denies?: { readonly tools: readonly string[]; readonly commands: readonly string[] };
}

/** Read each setting with its declared default, meaning and value source. */
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

/**
 * Only where the library lives, for everything that finds the library (routing, the app). Damage
 * elsewhere in settings.json is left for the settings that own it to report, so it never stops a
 * command that needs only the library (a context reading among them). The file must still be a
 * JSON object, and a damaged library setting is reported naming the file: where the library is
 * cannot be guessed, and is never read as local.
 */
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

/**
 * Only the experiment and arm this home names, none when it names none: like the library, read on its own, so damage
 * elsewhere in settings.json never stops a lane's lines being labelled, and a damaged value is reported naming the file.
 */
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

/**
 * The story parts switched off on this computer (ADR-1092 D2, ADR-1095), by part name, sorted; none when it names none.
 * Read on its own, like the library, since every host reads it as it starts; a damaged value is reported naming the file.
 */
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
    const value = (stored as Record<string, unknown>)[PARTS_OFF];
    return value === undefined ? [] : checkedPartsOff(value);
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before storytree can say which parts are switched off.`, { cause: error });
  }
}

/** The default factory folder's name (ADR-1118 D2): storytree collects no account name to call it by. */
const DEFAULT_FACTORY = "your-factory";

/**
 * This computer's factory folder: the one `settings set factory` chose, or else storytree's own, `your-factory`
 * (ADR-1118 D2). It sits beside a versioned home (`~/.storytree/0.3` keeps it at `~/.storytree/your-factory`, so it
 * outlasts the version) and inside any other home, so a lane's or a test's home keeps its own. Reading it writes
 * nothing; `makeFactoryFolder` makes the default. A damaged value is reported naming the file.
 */
export function factoryFolder(home: string = storytreeHome()): { readonly folder: string; readonly chosen: boolean; readonly switched?: FactorySwitched } {
  const stored = readStored(home);
  const chosen = stored.factory;
  if (chosen !== undefined) return { folder: chosen, chosen: true, ...(stored[FACTORY_SWITCHED] === undefined ? {} : { switched: stored[FACTORY_SWITCHED] }) };
  const full = path.resolve(home);
  return { folder: path.join(path.basename(path.dirname(full)) === ".storytree" ? path.dirname(full) : full, DEFAULT_FACTORY), chosen: false };
}

/**
 * This computer's factory folder, storytree's own made with the factory's shape (a `plugins` folder) when no other is
 * chosen and it is not there yet, without saving a setting: what the desktop app does as it starts (ADR-1118 D2).
 */
export function makeFactoryFolder(home: string = storytreeHome()): { readonly folder: string; readonly chosen: boolean } {
  const factory = factoryFolder(home);
  if (!factory.chosen) mkdirSync(path.join(factory.folder, "plugins"), { recursive: true });
  return factory;
}

/**
 * This computer's factory folder and the factory plugin standing in for each part it names: what a host hands the
 * plugin loader as it starts. A damaged value is reported naming the file.
 */
export function readStandIns(home: string = storytreeHome()): {
  readonly folder: string;
  readonly plugins: Readonly<Record<string, string>>;
  readonly switched: Readonly<Record<string, FactorySwitched>>;
  readonly history: Readonly<Record<string, readonly StandInSwitchedBack[]>>;
} {
  const stored = readStored(home);
  return { folder: factoryFolder(home).folder, plugins: stored[STAND_INS] ?? {}, switched: stored[STAND_INS_SWITCHED] ?? {}, history: stored[STAND_INS_HISTORY] ?? {} };
}

/** Where the factory folder, or a plugin standing in for a part, was switched from: no approval is asked (question_0b0b82eb8fbc), so this record is the safeguard. */
export type FactorySwitcher = { readonly through: "desktop app" | "command line" | "agent tool"; readonly session?: string };

/** Who switched this computer's factory folder, or a plugin standing in for a part, and when. */
export type FactorySwitched = FactorySwitcher & { readonly at: string };

/** A factory plugin that stood in for a part and was switched back: who switched it in (when that was recorded) and who switched it back, each with when. */
export interface StandInSwitchedBack {
  readonly plugin: string;
  readonly in?: FactorySwitched;
  readonly back: FactorySwitched;
}

/** A factory folder chosen: given the factory's shape just now, or found with it already. */
export interface ChosenFactory {
  readonly status: "set up" | "already a factory";
  readonly folder: string;
}

/**
 * Choose `folder`, an existing folder, as this computer's factory folder in place of storytree's own, saved as its full
 * path (`settings set factory`). An empty folder is given the factory's
 * shape, a `plugins` folder the plugin loader reads each plugin from, and one that has it is accepted; a folder holding
 * anything else is refused, left as it was and not saved. Hidden entries (a fresh repository's `.git`) do not count,
 * so a newly made private repo can be the factory. No approval is asked, from a person or an agent; who switched it
 * (`by`) and when is kept beside it.
 */
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

/**
 * The system switched off and on on this computer, none when it names none. Read on its own, like the parts, since an
 * agent's door reads it as it opens the project; a damaged value, or a name in both lists, is reported naming the file.
 */
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

/**
 * Switch the system named `name` off or on for this computer, and return what is now off and on. Off takes it out of
 * the on list and into the off list; on takes it out of the off list and, unless it is `all`, into the on list, so it
 * beats a wider name switched off.
 */
export function setSystemSwitch(name: string, off: boolean, home: string = storytreeHome()): SystemSwitches {
  const stored = readStored(home);
  const without = (names: readonly string[] | undefined) => (names ?? []).filter((one) => one !== name);
  const switches = off
    ? { off: [...without(stored[SYSTEM_OFF]), name].sort(), on: without(stored[SYSTEM_ON]) }
    : { off: without(stored[SYSTEM_OFF]), on: name === "all" ? without(stored[SYSTEM_ON]) : [...without(stored[SYSTEM_ON]), name].sort() };
  write(home, { ...stored, [SYSTEM_OFF]: switches.off, [SYSTEM_ON]: switches.on });
  return switches;
}

/**
 * Switch the story part `part` off or on for this computer, and return the parts now off. The core is refused: this
 * story's own copy of the plugin loader's (ADR-1017 D2), which never leaves it out. Whether `part` is one a host has is
 * the switch's to check, since only a host knows its parts. Switched off with `plugin`, that factory plugin is named to
 * stand in for it, with who switched it (`by`) and when (ADR-1126 D2); any other switch drops its stand-in and that record,
 * which moves to the part's history beside who switched it back (`by`) and when, so the record outlives the stand-in.
 */
export function setPartOff(part: string, off: boolean, home: string = storytreeHome(), plugin?: string, by: FactorySwitcher = { through: "command line" }, now: Date = new Date()): readonly string[] {
  if (CORE.includes(part)) refuse(`${part} is the core, which every host stands on, so it is never switched off.`);
  const stored = readStored(home);
  const rest = (stored[PARTS_OFF] ?? []).filter((one) => one !== part);
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
    [PARTS_OFF]: parts,
    ...(stored[STAND_INS] === undefined && plugin === undefined ? {} : { [STAND_INS]: named }),
    ...(stored[STAND_INS_SWITCHED] === undefined && plugin === undefined ? {} : { [STAND_INS_SWITCHED]: recorded }),
    ...(was === undefined ? {} : { [STAND_INS_HISTORY]: backed }),
  });
  return parts;
}

/** The user's approval of a project's checked-in worktree setup: its commands' fingerprint, and when it was given (capability 19, 19.6). */
export interface SetupApproval {
  readonly fingerprint: string;
  readonly at: string;
}

/** The approval the user gave the checked-in worktree setup of the repository whose main checkout is `repository`, if any. */
export function readSetupApproval(repository: string, home: string = storytreeHome()): SetupApproval | undefined {
  return readStored(home)[SETUP_APPROVALS]?.[repository];
}

/** Record the user's approval of `repository`'s checked-in setup commands with `fingerprint`, replacing any earlier one. */
export function setSetupApproval(repository: string, fingerprint: string, home: string = storytreeHome(), now: Date = new Date()): SetupApproval {
  const stored = readStored(home);
  const approval = { fingerprint, at: now.toISOString() };
  write(home, { ...stored, [SETUP_APPROVALS]: { ...stored[SETUP_APPROVALS], [repository]: approval } });
  return approval;
}

/** Persist a user's choice in the same home as project-choice.json, after checking its type. */
export function setSetting(name: string, value: string, home: string = storytreeHome()): SettingReading {
  checkName(name);
  if (name === library.name) return refuse("Set the library with `storytree settings set library local`, `… library cloudsql <instance> <user>`, or `… library postgres <address>`.");
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

/**
 * Persist where the library lives: `["local"]`, `["cloudsql", <instance connection name>, <account email>]`,
 * or `["postgres", <address>]`. All of it is checked before anything is written, so the setting is never half-set.
 */
export function setLibrary(words: readonly string[], home: string = storytreeHome()): LibraryReading {
  const given = words[0] === "cloudsql" ? { location: "cloudsql", instance: words[1], user: words[2] }
    : words[0] === "postgres" ? { location: "postgres", address: words[1] }
    : { location: words[0] };
  const location = checkedLibrary(given, words.length);
  write(home, { ...readStored(home), library: location });
  return readSettings(home).library;
}

/** The surface choices saved in the settings file, none when it has none. */
export function readSurfaceChoices(home: string = storytreeHome()): SurfaceChoices {
  return readStored(home).surfaces ?? {};
}

/** Save one surface choice (`on`, or a setting's id) beside the rest, the file checked first. */
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

/** A health limit: a positive whole number, and for the disk a percentage, at most 100. */
function checkedHealth(value: unknown, name: HealthName): number {
  const most = name === healthDisk.name ? 100 : Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > most) {
    refuse(name === healthDisk.name ? `${name} must be a whole number of percent from 1 to 100.` : `${name} must be a positive whole number.`);
  }
  return value;
}

/** The current idle duration in milliseconds; read afresh so a running session sees changes. */
export function idleAfterMs(home?: string): number {
  return checkedDuration(readSettings(home)["idle-after"].value);
}

/** The current leave-after duration in milliseconds (ADR-0754 D4); read afresh so a running reader sees changes. */
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

/**
 * A Cloud SQL instance's connection name, project:region:instance (a project in a domain keeps it:
 * example.com:my-project:region:instance), as the library's Cloud SQL connection reads it.
 */
const CONNECTION_NAME =
  /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+:)?[a-z][a-z0-9-]*[a-z0-9]:[a-z][a-z0-9-]*[a-z0-9]:[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
/** A Google account's email: one @, with no spaces or control characters. */
const ACCOUNT = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+$/u;

/**
 * A stored or given library location, if it is one; refused with what to write otherwise. `words`
 * counts the words a command gave, so a stray extra one is refused rather than dropped.
 */
function checkedLibrary(value: unknown, words?: number): LibraryLocation {
  const usage =
    "library is `local`; `cloudsql <instance> <user>`: the instance's connection name (project:region:instance) " +
    "and the email of the Google account to sign in as; or `postgres <address>`: postgres://<user>@<host>[:<port>]/<database> or wss://<user>@<host>[:<port>]/<database>.";
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse(usage);
  const { location, instance, user, address, ...rest } = value as { location?: unknown; instance?: unknown; user?: unknown; address?: unknown };
  if (Object.keys(rest).length > 0) return refuse(usage);
  if (location === "local" && instance === undefined && user === undefined && address === undefined && (words ?? 1) === 1) return { location };
  if (location === "postgres" && instance === undefined && user === undefined && (words ?? 2) === 2) return { location, address: checkedAddress(address) };
  if (address !== undefined) return refuse(usage);
  if (location !== "cloudsql" || (words !== undefined && words !== 3)) return refuse(usage);
  if (typeof instance !== "string" || !CONNECTION_NAME.test(instance)) {
    return refuse(`library: the Cloud SQL instance ${JSON.stringify(instance)} is not written project:region:instance. Copy its connection name from the instance's page in the Cloud Console.`);
  }
  if (typeof user !== "string" || !ACCOUNT.test(user)) return refuse(`library: the Cloud SQL user ${JSON.stringify(user)} is not a Google account's email.`);
  return { location, instance, user };
}

/**
 * A Postgres address as the library setting keeps it: a postgres:// URL, or a wss:// one for Postgres
 * over a WebSocket, naming a user and a host, with no password. A password belongs in the key store (ADR-0843), so one given here is refused
 * without being repeated.
 */
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

const PARTS_OFF = "parts-off";

/** The core, never switched off: this story's own copy of the plugin loader's (ADR-1017 D2). */
export const CORE: readonly string[] = ["library", "plugin-loader", "project-and-caller"];

function checkedPartsOff(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((one) => typeof one === "string" && one !== "")) refuse(`${PARTS_OFF} must list the names of the story parts switched off, such as ["forest"].`);
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
    // A dangling symlink exists but cannot be read; it must not become a default or be replaced.
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
      if (name === PARTS_OFF) {
        settings[PARTS_OFF] = checkedPartsOff(value);
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
