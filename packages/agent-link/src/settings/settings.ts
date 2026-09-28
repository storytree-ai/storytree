/** Capability 10 · Per-user settings, owned by the agent link (ADR-0729). */
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
export function readSettings(_home: string = storytreeHome()): SettingsReading {
  return { "context-guidance": { ...contextGuidance, value: contextGuidance.default, source: "default" } };
}
