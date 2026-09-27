/**
 * Capability 6 · Rounds (stories/librarian.md): when the librarian's pass runs, and what it looks
 * at. Graduation is due at every landing, because only this session knows what it learned; the
 * rest is due when the library's change feed since the session started shows a write to a curated
 * kind, and when there is no start to read from, since the trigger fires when unsure (0.2's
 * `pre-merge-librarian-pass`). The worklist gathers each capability's list into one report.
 */
import type { Library, Related, SchemaRecord } from "@storytree/library";

import { newNotes, type NewNote } from "../catalogue/index.js";
import { brokenEdges, type BrokenEdge } from "../decision-log/index.js";
import { memoryWorklist, processGaps, type MemoryItem, type ProcessGaps } from "../graduation/index.js";
import { relatedUnlinked, unrestedDecisions } from "../links/index.js";
import { frictionDrain, openQuestions } from "../queues/index.js";

/** The curated kinds: a write to any of them since the session started makes the whole pass due. */
export const CURATED: readonly string[] = ["decision", "question", "principle", "guardrail", "pattern", "process", "definition", "agent"];

/** What the pass has to do: graduation always, the rest when the trigger fired. */
export interface RoundDue {
  readonly graduation: true;
  readonly rest: boolean;
}

/** What the worklist is gathered from. */
export interface WorklistOptions {
  /** The change feed's cursor when the session started. Without it the trigger fires. */
  readonly since?: number;
  /** The session's branch: the friction drain never holds a report filed from it. */
  readonly branch?: string;
  /** The agent's memory folders. */
  readonly memoryFolders?: readonly string[];
  /** The tools served, to match against the processes; without them, processes are not matched. */
  readonly tools?: readonly string[];
  readonly now?: Date;
}

/** The librarian's worklist: each capability's list. */
export interface Worklist {
  /** Graduation (4): memories new, changed or lapsed. Always there. */
  readonly graduation: MemoryItem[];
  /** The rest, when the trigger fired. */
  readonly rest?: {
    /** Links (1): accepted decisions on no shelf that nothing rests on. */
    readonly links: SchemaRecord<"decision">[];
    /** Links (1): related but unlinked neighbours for notes written since the session started. */
    readonly related: Related[];
    /** Decision log (2), the health report: edges to records no longer live. */
    readonly health: BrokenEdge[];
    /** Catalogue (3): notes written new since the session started, with what might already cover them. */
    readonly catalogue: NewNote[];
    /** Graduation (4): processes and tools that match nothing, when the tools served are known. */
    readonly processes?: ProcessGaps;
    /** Queues (5): open questions whose review lease has lapsed, longest lapsed first. */
    readonly questions: SchemaRecord<"question">[];
    /** Queues (5): the friction drain. */
    readonly friction: SchemaRecord<"friction">[];
  };
}

/** Whether the pass is due: graduation always; the rest on a curated write since `since`, or with no `since`. */
export async function roundDue(library: Library, { since }: { since?: number }): Promise<RoundDue> {
  if (since === undefined) return { graduation: true, rest: true };
  const { changes } = await library.changesSince(since);
  return { graduation: true, rest: changes.some((change) => CURATED.includes(change.type)) };
}

/** Gather the worklist: graduation's list always, the rest when the trigger fired. */
export async function worklist(library: Library, options: WorklistOptions): Promise<Worklist> {
  const graduation = await memoryWorklist(options.memoryFolders ?? [], options.now === undefined ? {} : { now: options.now });
  if (!(await roundDue(library, options)).rest) return { graduation };
  return {
    graduation,
    rest: {
      links: await unrestedDecisions(library),
      related: await relatedUnlinked(library, options.since ?? 0),
      health: await brokenEdges(library),
      catalogue: await newNotes(library, options.since ?? 0),
      ...(options.tools === undefined ? {} : { processes: await processGaps(library, options.tools) }),
      questions: await openQuestions(library, options.now),
      friction: await frictionDrain(library, options.branch === undefined ? {} : { branch: options.branch }),
    },
  };
}
