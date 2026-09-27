/** Capability 2's founding book (G2): earlier decisions sit as ghosts beside their replacements. */
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

export function knowledge(_changes: readonly Change[]): Knowledge {
  return { notes: new Map(), active: new Set(), ghosts: new Map(), proposed: new Set(), linksIn: new Map() };
}
