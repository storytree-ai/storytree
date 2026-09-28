/** Capability 10 · Per-user settings, owned by the agent link (ADR-0729; the library's location, ADR-0734/0735). */
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { storytreeHome } from "../routing/index.js";

const contextGuidance = {
  name: "context-guidance",
  type: "positive whole number",
  unit: "tokens",
  default: 700_000,
  meaning: "Soft guidance for context size in tokens; it does not enforce a hard limit.",
} as const;

const library = {
  name: "library",
  default: "local",
  meaning:
    "Where the library lives: `local`, the storytree app's own database on this computer, or `cloudsql`, " +
    "a Google Cloud SQL instance signed in to as your Google account (set with its connection name and the account's email).",
} as const;

export interface SettingReading {
  readonly name: "context-guidance";
  readonly type: "positive whole number";
  readonly unit: "tokens";
  readonly default: number;
  readonly meaning: string;
  readonly value: number;
  readonly source: "default" | "set";
}

/** Where the library lives: this computer's app, or a Cloud SQL instance and the account to sign in to it as. */
export type LibraryLocation = { readonly location: "local" } | { readonly location: "cloudsql"; readonly instance: string; readonly user: string };

export type LibraryReading = LibraryLocation & {
  readonly name: "library";
  readonly default: "local";
  readonly meaning: string;
  readonly source: "default" | "set";
};

export interface SettingsReading {
  readonly "context-guidance": SettingReading;
  readonly library: LibraryReading;
}

interface Stored {
  "context-guidance"?: number;
  library?: LibraryLocation;
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
    library: { ...library, ...(stored.library ?? { location: "local" }), source: stored.library === undefined ? "default" : "set" },
  };
}

/** Persist a user's choice of a whole-number setting in the same home as project-choice.json. */
export function setSetting(name: string, value: string, home: string = storytreeHome()): SettingReading {
  checkName(name);
  if (name === library.name) return refuse("Set the library with `storytree settings set library local`, or `… library cloudsql <instance> <user>`.");
  const number = checkedGuidance(/^\d+$/.test(value) ? Number(value) : NaN);
  write(home, { ...readStored(home), [name]: number });
  return readSettings(home)["context-guidance"];
}

/**
 * Persist where the library lives: `["local"]`, or `["cloudsql", <instance connection name>, <account email>]`.
 * All of it is checked before anything is written, so the setting is never half-set.
 */
export function setLibrary(words: readonly string[], home: string = storytreeHome()): LibraryReading {
  const given = words[0] === "cloudsql" ? { location: "cloudsql", instance: words[1], user: words[2] } : { location: words[0] };
  const location = checkedLibrary(given, words.length);
  write(home, { ...readStored(home), library: location });
  return readSettings(home).library;
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

function checkName(name: string): asserts name is "context-guidance" | "library" {
  if (name !== contextGuidance.name && name !== library.name) {
    refuse(`Unknown setting ${JSON.stringify(name)}. Available settings: ${contextGuidance.name}, ${library.name}.`);
  }
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
    "library is `local`, or `cloudsql <instance> <user>`: the instance's connection name (project:region:instance) " +
    "and the email of the Google account to sign in as.";
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse(usage);
  const { location, instance, user, ...rest } = value as { location?: unknown; instance?: unknown; user?: unknown };
  if (Object.keys(rest).length > 0) return refuse(usage);
  if (location === "local" && instance === undefined && user === undefined && (words ?? 1) === 1) return { location };
  if (location !== "cloudsql" || (words !== undefined && words !== 3)) return refuse(usage);
  if (typeof instance !== "string" || !CONNECTION_NAME.test(instance)) {
    return refuse(`library: the Cloud SQL instance ${JSON.stringify(instance)} is not written project:region:instance. Copy its connection name from the instance's page in the Cloud Console.`);
  }
  if (typeof user !== "string" || !ACCOUNT.test(user)) return refuse(`library: the Cloud SQL user ${JSON.stringify(user)} is not a Google account's email.`);
  return { location, instance, user };
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
      checkName(name);
      if (name === "library") settings.library = checkedLibrary(value);
      else settings[name] = checkedGuidance(value);
    }
    return settings;
  } catch (error) {
    throw new Error(`Invalid settings file "${file}": ${(error as Error).message} Repair it before reading or changing settings.`, { cause: error });
  }
}
