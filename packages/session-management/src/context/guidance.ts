// Capability 9 · Context readings
import { readSettings } from "@storytree/project-and-caller";

export type ContextGuidance = {
  readonly value: number;
  readonly source: "default" | "set";
  readonly position: "under" | "at" | "past";
} | { readonly absent: string };

export function contextGuidance(tokens: number, home?: string): ContextGuidance {
  try {
    const { value, source } = readSettings(home)["context-guidance"];
    return { value, source, position: tokens > value ? "past" : tokens < value ? "under" : "at" };
  } catch (error) {
    return { absent: error instanceof Error ? error.message : String(error) };
  }
}

export function guidanceSentence(guidance: ContextGuidance): string {
  if ("absent" in guidance) return `Context guidance could not be read: ${guidance.absent}`;
  return `This is ${guidance.position} the context guidance of ${guidance.value.toLocaleString("en-US")} tokens (${guidance.source}).`;
}
