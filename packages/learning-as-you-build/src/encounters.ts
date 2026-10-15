/**
 * Capability 2 · First encounters. Which kinds are on the user's map now, each with the first thing of
 * its kind to anchor its card to, read from the page's own reading: the tree, its history and the agent
 * log. Whether a kind has been seen before is the journal's (journal.ts).
 */
import { KINDS, type Kind } from "./cards.js";

/** What a card points at: the map itself, or a thing on it the frame can locate. */
export type Target =
  | { kind: "map" }
  /** The top bar's switch to the factory and back. */
  | { kind: "switch" }
  | { kind: "arc"; arc: string }
  | { kind: "story"; story: string }
  | { kind: "capability"; story: string; capability: string }
  | { kind: "note"; note: string }
  | { kind: "question"; question: string };

export interface Encounter { kind: Kind; target: Target }

/** The little of the page's reading it reads (the library's AnnotatedTree, Change and Line fit it). */
export interface MapReading {
  tree: { stories: readonly { id: string; capabilities: readonly { id: string; proposed: boolean }[] }[]; arcs: readonly { id: string }[] };
  /** The project's history, oldest first. */
  changes: readonly { type: string; recordId: string; action: string; record: { fields: Record<string, unknown> } }[];
  /** The agent log's lines, oldest first. */
  lines: readonly { kind: string; capability?: string | undefined; increment?: string | undefined }[];
  /** Whether the project on show is the user's factory (ADR-1048 D3). */
  factory?: boolean;
}

/** The factory's parts, by the kinds of record they are in its library (library's SYSTEM_KINDS). */
const PARTS: readonly { kind: Kind; types: readonly string[] }[] = [
  { kind: "role", types: ["agent"] },
  { kind: "note", types: ["principle", "pattern", "process", "guardrail"] },
  { kind: "check", types: ["check"] },
];

/**
 * Every kind on the map, in KINDS' order, with the first of it; an empty product's map is the one kind "empty". On a
 * factory, the factory itself, at the switch that brought the user there, and its parts.
 */
export function encounters({ tree, changes, lines, factory = false }: MapReading): Encounter[] {
  if (!factory && tree.stories.length === 0 && tree.arcs.length === 0) return [{ kind: "empty", target: { kind: "map" } }];
  const found = new Map<Kind, Target>();
  if (factory) found.set("factory", { kind: "switch" });
  const parts = tree.stories.flatMap(story => story.capabilities.map(capability => ({ story: story.id, capability })));
  const part = (one: (typeof parts)[number]): Target => ({ kind: "capability", story: one.story, capability: one.capability.id });
  const arc = tree.arcs[0];
  if (arc !== undefined) found.set("arc", { kind: "arc", arc: arc.id });
  const story = tree.stories[0];
  if (story !== undefined) found.set("story", { kind: "story", story: story.id });
  if (parts[0] !== undefined) found.set("capability", part(parts[0]));
  const claimed = lines.find(line => line.kind === "claimed" && parts.some(one => one.capability.id === line.capability));
  const held = parts.find(one => one.capability.id === claimed?.capability);
  if (held !== undefined) found.set("claim", part(held));
  const built = parts.find(one => !one.capability.proposed);
  if (built !== undefined) found.set("health", part(built));
  // Each record as the history last left it: a retired one is gone from the map.
  const last = new Map<string, (typeof changes)[number]>();
  for (const change of changes) last.set(change.recordId, change);
  const live = [...last.values()].filter(change => change.action !== "retired");
  const decision = live.find(change => change.type === "decision");
  if (decision !== undefined) found.set("decision", { kind: "note", note: decision.recordId });
  if (factory) {
    for (const part of PARTS) {
      const first = live.find(change => part.types.includes(change.type));
      if (first !== undefined) found.set(part.kind, { kind: "note", note: first.recordId });
    }
  }
  const question = live.find(change => change.type === "question" && change.record.fields.lifecycle === "open");
  if (question !== undefined) found.set("question", { kind: "question", question: question.recordId });
  return KINDS.flatMap(kind => { const target = found.get(kind); return target === undefined ? [] : [{ kind, target }]; });
}
