/** Capability 2 · Earlier decisions beside their replacements. Capability 2's founding book (G2): earlier decisions sit as ghosts beside their replacements. */
import type { Change, RecordEnvelope } from "@storytree/library";

/** What made a decision a ghost: the decision log's supersession, or the older cover-history recipe. */
export type GhostEvidence = "superseded" | "earlier-cover";

export interface Ghost {
  note: string;
  evidence: GhostEvidence;
  /** The decision that replaced it directly; undefined when more than one did. */
  replacedBy: string | undefined;
  /** The current decision it sits beside, at the end of its chain of replacements; undefined when not placed. */
  beside: string | undefined;
  label: string;
}

/** A project's knowledge as the core reads it from the library's change history. */
export interface Knowledge {
  /** Every live note, ghosts and proposals included, by id. */
  notes: ReadonlyMap<string, RecordEnvelope>;
  /** The notes that are neither ghosts nor proposed: the only ones depth and link counts use. */
  active: ReadonlySet<string>;
  ghosts: ReadonlyMap<string, Ghost>;
  proposed: ReadonlySet<string>;
  /** For each active note, how many distinct active notes link to it. */
  linksIn: ReadonlyMap<string, number>;
}

/** The library's note kinds (its NoteType): memory notes, decisions, definitions, the eight kinds and quality control checks. */
const NOTE_TYPES = new Set(["memory", "decision", "definition", "principle", "guardrail", "pattern", "process", "agent", "friction", "resteer", "techstack", "check"]);

/**
 * Read a project's knowledge from its change history (changesSince(0)): its live notes, which
 * decisions are ghosts and beside what, which are proposed, and the links between the rest.
 *
 * A decision is superseded once an accepted decision names it in `supersedes`, the library's own
 * reading (capability 13), whether or not its cover mark was cleared. Failing that, the older
 * recipe makes it an "earlier cover": its mark on a shelf was cleared while a newer cover on that
 * same shelf linked to it, and it has not been marked since. Proposed decisions are neither.
 */
export function knowledge(changes: readonly Change[]): Knowledge {
  const notes = new Map<string, RecordEnvelope>();
  const created = new Map<string, number>();
  /** For each decision whose mark was cleared, the newer covers on its shelf that linked to it then. */
  const clearedFor = new Map<string, string[]>();

  for (const change of changes) {
    if (!NOTE_TYPES.has(change.type)) continue;
    const before = notes.get(change.recordId);
    if (change.action === "retired") {
      notes.delete(change.recordId);
      continue;
    }
    if (change.action === "created") created.set(change.recordId, change.seq);
    const shelf = before === undefined ? undefined : coverOf(before);
    const after = coverOf(change.record);
    if (change.type === "decision" && after !== undefined) clearedFor.delete(change.recordId);
    if (change.type === "decision" && shelf !== undefined && after === undefined) {
      const id = change.recordId;
      const since = created.get(id) ?? change.seq;
      const covers = [...notes.values()].filter(
        (note) => note.id !== id && note.type === "decision" && coverOf(note) === shelf && linksOf(note).includes(id) && (created.get(note.id) ?? 0) > since,
      );
      clearedFor.set(id, covers.map(({ id: cover }) => cover));
    }
    notes.set(change.recordId, change.record);
  }

  const decisions = [...notes.values()].filter((note) => note.type === "decision");
  const proposed = new Set(decisions.filter((decision) => decision.fields.status === "proposed").map(({ id }) => id));
  const supersededBy = new Map<string, string[]>();
  for (const decision of decisions) {
    if (decision.fields.status !== "accepted") continue;
    for (const old of stringsIn(decision.fields.supersedes)) supersededBy.set(old, [...(supersededBy.get(old) ?? []), decision.id]);
  }

  const direct = new Map<string, { evidence: GhostEvidence; replacedBy: string | undefined }>();
  for (const decision of decisions) {
    if (proposed.has(decision.id)) continue;
    const by = supersededBy.get(decision.id);
    const earlier = clearedFor.get(decision.id);
    if (by !== undefined) direct.set(decision.id, { evidence: "superseded", replacedBy: by.length === 1 ? by[0] : undefined });
    else if (earlier !== undefined && earlier.length > 0) direct.set(decision.id, { evidence: "earlier-cover", replacedBy: earlier.length === 1 ? earlier[0] : undefined });
  }

  const ghosts = new Map<string, Ghost>();
  for (const [note, { evidence, replacedBy }] of direct) {
    const beside = currentSuccessor(replacedBy, notes, direct, proposed);
    const label = beside === undefined ? "replacement not placed" : evidence === "superseded" ? `superseded by ${replacedBy}` : `earlier cover, replaced by ${replacedBy}`;
    ghosts.set(note, { note, evidence, replacedBy, beside, label });
  }

  const active = new Set([...notes.keys()].filter((id) => !ghosts.has(id) && !proposed.has(id)));
  const linksIn = new Map([...active].map((id) => [id, 0]));
  for (const id of active) {
    for (const target of new Set(linksOf(notes.get(id)!))) {
      if (target !== id && linksIn.has(target)) linksIn.set(target, linksIn.get(target)! + 1);
    }
  }
  return { notes, active, ghosts, proposed, linksIn };
}

/** Follow replacements to the first live, current, accepted decision; undefined when the chain breaks or branches. */
function currentSuccessor(
  first: string | undefined,
  notes: ReadonlyMap<string, RecordEnvelope>,
  direct: ReadonlyMap<string, { replacedBy: string | undefined }>,
  proposed: ReadonlySet<string>,
): string | undefined {
  const seen = new Set<string>();
  for (let at = first; at !== undefined && !seen.has(at); at = direct.get(at)?.replacedBy) {
    if (!notes.has(at) || proposed.has(at)) return undefined;
    if (!direct.has(at)) return at;
    seen.add(at);
  }
  return undefined;
}

function coverOf(record: RecordEnvelope): string | undefined {
  const cover = record.fields.frontCoverOf;
  return typeof cover === "string" ? cover : undefined;
}

/** A note's stored links, in their stored order. */
export function linksOf(record: RecordEnvelope): string[] {
  return stringsIn(record.fields.links);
}

/**
 * Whether a stored reference joins two notes, either way round: one's `links`, `supersedes` or
 * `frontCoverOf` names the other. Only what is stored joins them, never a neighbour they share.
 */
export function storedEdges({ notes }: Knowledge): (a: string, b: string) => boolean {
  const joined = new Set<string>();
  for (const note of notes.values()) {
    const cover = coverOf(note);
    for (const to of [...linksOf(note), ...stringsIn(note.fields.supersedes), ...(cover === undefined ? [] : [cover])]) {
      if (to !== note.id) joined.add(`${note.id}>${to}`).add(`${to}>${note.id}`);
    }
  }
  return (a, b) => joined.has(`${a}>${b}`);
}

function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
