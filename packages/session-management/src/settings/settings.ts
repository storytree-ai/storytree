/** Capability 10 · Per-user settings, owned by Session management (ADR-0729; the library's location, ADR-0734/0735). */
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { storytreeHome } from "../routing/index.js";

/** The gear menu tab a setting shows under (Session management's settings view offers its rows by group). */
export type SettingGroup = "sessions" | "library";

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

const library = {
  name: "library",
  group: "library",
  label: "Where the library lives",
  default: "local",
  meaning:
    "Where the library lives: `local`, the storytree app's own database on this computer; `cloudsql`, " +
    "a Google Cloud SQL instance signed in to as your Google account (set with its connection name and the account's email); " +
    "or `postgres`, any Postgres reached by its address (postgres://user@host:port/database), its password saved as the key `postgres` with `storytree auth set postgres`.",
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

export type SettingReading = ContextGuidanceReading | IdleReading;

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
  readonly library: LibraryReading;
}

/**
 * The app's surface choices (ADR-0750): per surface id, `on` and each setting's chosen value. The
 * Session management keeps them and checks their shape; each story declares what they mean.
 */
export type SurfaceChoices = Readonly<Record<string, Readonly<Record<string, boolean | string>>>>;

interface Stored {
  "context-guidance"?: number;
  "idle-after"?: string;
  "leave-after"?: string;
  library?: LibraryLocation;
  surfaces?: SurfaceChoices;
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
    library: { ...library, ...(stored.library ?? { location: "local" }), source: stored.library === undefined ? "default" : "set" },
  };
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

/** Persist a user's choice in the same home as project-choice.json, after checking its type. */
export function setSetting(name: string, value: string, home: string = storytreeHome()): SettingReading {
  checkName(name);
  if (name === library.name) return refuse("Set the library with `storytree settings set library local`, `… library cloudsql <instance> <user>`, or `… library postgres <address>`.");
  if (name === idleAfter.name || name === leaveAfter.name) {
    checkedDuration(value, name);
    write(home, { ...readStored(home), [name]: value });
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

function checkName(name: string): asserts name is "context-guidance" | "idle-after" | "leave-after" | "library" {
  if (name !== contextGuidance.name && name !== idleAfter.name && name !== leaveAfter.name && name !== library.name) {
    refuse(`Unknown setting ${JSON.stringify(name)}. Available settings: ${contextGuidance.name}, ${idleAfter.name}, ${leaveAfter.name}, ${library.name}.`);
  }
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
    "and the email of the Google account to sign in as; or `postgres <address>`: postgres://<user>@<host>[:<port>]/<database>.";
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
 * A Postgres address as the library setting keeps it: a postgres:// URL naming a user and a host,
 * with no password. A password belongs in the key store (ADR-0843), so one given here is refused
 * without being repeated.
 */
function checkedAddress(address: unknown): string {
  const usage = "library: a Postgres address is written postgres://<user>@<host>[:<port>]/<database>, with ?sslmode=… where the server needs it.";
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
  if (!/^postgres(ql)?:$/.test(url.protocol) || url.hostname === "" || url.username === "") return refuse(usage);
  return address;
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
      checkName(name);
      if (name === "library") settings.library = checkedLibrary(value);
      else if (name === "idle-after" || name === "leave-after") {
        checkedDuration(value, name);
        settings[name] = value as string;
      }
      else settings[name] = checkedGuidance(value);
    }
    return settings;
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before reading or changing settings.`, { cause: error });
  }
}
