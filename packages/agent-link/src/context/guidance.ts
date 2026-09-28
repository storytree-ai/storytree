/** Contract 9.7: guidance is a fresh settings reading, never an enforced limit. */
import { readSettings } from "../settings/settings.js";

export type ContextGuidance = {
  readonly value: number;
  readonly source: "default" | "set";
  readonly position: "under" | "at" | "past";
} | { readonly absent: string };

/** Keep a usable token count even when settings cannot be read. */
export function contextGuidance(tokens: number, home?: string): ContextGuidance {
  try {
    const { value, source } = readSettings(home)["context-guidance"];
    return { value, source, position: tokens > value ? "past" : tokens < value ? "under" : "at" };
  } catch (error) {
    return { absent: error instanceof Error ? error.message : String(error) };
  }
}

/** The CLI and agent tool state the same guidance and any reason it is unavailable. */
export function guidanceSentence(guidance: ContextGuidance): string {
  if ("absent" in guidance) return `Context guidance could not be read: ${guidance.absent}`;
  return `This is ${guidance.position} the context guidance of ${guidance.value.toLocaleString("en-US")} tokens (${guidance.source}).`;
}
