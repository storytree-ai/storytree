// Capability 5 · Show and filter by artifact kind
import type { RecordEnvelope } from "@storytree/library";

import type { Knowledge } from "../ghosts/ghosts.js";

const KINDS: readonly { kind: string; label: string; colour: string }[] = [
  { kind: "decision", label: "Decisions", colour: "#7fb2e5" },
  { kind: "definition", label: "Definitions", colour: "#8fd3c4" },
  { kind: "principle", label: "Principles", colour: "#e3c56f" },
  { kind: "guardrail", label: "Guardrails", colour: "#e58f8f" },
  { kind: "pattern", label: "Patterns", colour: "#b79ce0" },
  { kind: "process", label: "Processes", colour: "#93d08f" },
  { kind: "agent", label: "Agent roles", colour: "#e0a3cf" },
  { kind: "check", label: "Checks", colour: "#d9a273" },
  { kind: "techstack", label: "Tech stack", colour: "#b6c98a" },
  { kind: "research", label: "Research", colour: "#9f9fe6" },
  { kind: "memory", label: "Memory", colour: "#c9c1a0" },
  { kind: "resteer", label: "Re-steers", colour: "#c7a98a" },
  { kind: "friction", label: "Friction", colour: "#9aa3ad" },
];

const OTHER = "#a5c5d1";

export const HIDDEN_AT_START: ReadonlySet<string> = new Set(["friction", "resteer"]);

export interface KindRow {
  kind: string;
  label: string;
  colour: string;
  count: number;
  shown: boolean;
}

export function kindRows({ notes, active }: Knowledge, hidden: ReadonlySet<string>): KindRow[] {
  const counts = new Map<string, number>();
  for (const id of active) {
    const note = notes.get(id)!;
    counts.set(note.type, (counts.get(note.type) ?? 0) + 1);
  }
  return KINDS.filter(({ kind }) => counts.has(kind)).map(row => ({ ...row, count: counts.get(row.kind)!, shown: !hidden.has(row.kind) }));
}

export function drawnPoints<P extends { id: string }>(points: readonly P[], notes: ReadonlyMap<string, RecordEnvelope>, hidden: ReadonlySet<string>, kept: ReadonlySet<string>): P[] {
  return hidden.size === 0 ? [...points] : points.filter(({ id }) => kept.has(id) || !hidden.has(notes.get(id)?.type ?? ""));
}

export function dotColour(kind: string | undefined, session: string | undefined): string {
  return session ?? KINDS.find(row => row.kind === kind)?.colour ?? OTHER;
}
