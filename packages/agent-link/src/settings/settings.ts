/** Capability 10 · Per-user settings, owned by the agent link (ADR-0729). */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { storytreeHome } from "../routing/index.js";

const contextGuidance = {
  name: "context-guidance",
  type: "positive whole number",
  unit: "tokens",
  default: 700_000,
  meaning: "Soft guidance for context size in tokens; it does not enforce a hard limit.",
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

export type SettingsReading = Readonly<Record<"context-guidance", SettingReading>>;

/** Read each setting with its declared default, type, unit, meaning and value source. */
export function readSettings(home: string = storytreeHome()): SettingsReading {
  const value = readOverrides(home)["context-guidance"];
  return { "context-guidance": {
    ...contextGuidance,
    value: value ?? contextGuidance.default,
    source: value === undefined ? "default" : "set",
  } };
}

/** Persist a user's choice in the same home as project-choice.json. */
export function setSetting(name: string, value: string, home: string = storytreeHome()): SettingReading {
  checkName(name);
  const number = checkedValue(/^\d+$/.test(value) ? Number(value) : NaN);
  const overrides = { ...readOverrides(home), [name]: number };
  mkdirSync(home, { recursive: true });
  const file = path.join(home, "settings.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(overrides, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return readSettings(home)["context-guidance"];
}

function checkName(name: string): asserts name is "context-guidance" {
  if (name !== contextGuidance.name) throw new Error(`Unknown setting ${JSON.stringify(name)}. Available setting: ${contextGuidance.name}.`);
}

function checkedValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${contextGuidance.name} must be a positive whole number of tokens (at most ${Number.MAX_SAFE_INTEGER}).`);
  }
  return value;
}

function readOverrides(home: string): Partial<Record<"context-guidance", number>> {
  let text: string;
  try {
    text = readFileSync(path.join(home, "settings.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return JSON.parse(text) as Partial<Record<"context-guidance", number>>;
}
