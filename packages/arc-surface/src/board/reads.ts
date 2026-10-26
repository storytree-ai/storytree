/** Capability 3 · Arc surface. */
import type { BoardArcView, DayWindow, Holds, PrCutover } from "@storytree/library";
import type { LiveReads } from "../live-reading/live-reading.js";
import type { BoardSnapshot } from "./board.js";
import { recentWindow } from "./closed-range.js";

/** Read-only calls carried by the app. Whether a wait/question holds remains the library's answer. */
export interface BoardReads extends LiveReads {
  /** Every live arc, and those closed in `closed`, in one reading (library 10.22): one ask per refresh, never one per arc. */
  boardArcs(project: string, closed: DayWindow): Promise<readonly BoardArcView[]>;
  /** The arcs closed in `window` (library 10.22): asked only when the Closed tab's range reaches past the routine read. */
  closedArcs(project: string, window: DayWindow): Promise<readonly BoardArcView[]>;
  /** Every hold on the project's live work in one reading: one ask per refresh, never one per arc or increment. */
  holds(project: string): Promise<Holds>;
  /** The user's idle-after setting in milliseconds, read now; without it a holder reads idle after 30 minutes. */
  idleAfterMs?(): Promise<number>;
  /** The project's repository cut-over, undefined while it has none: what an old closure's pull request number is said by. */
  prCutover?(project: string): Promise<PrCutover | undefined>;
}
/** The routine read (3.12): live arcs and those closed yesterday or today at `now`, and every hold. */
export async function readBoard(project: string, reads: BoardReads, now: number = Date.now()): Promise<BoardSnapshot> {
  const [arcs, { waits, heldOn, waitsFor }, cutover] = await Promise.all([reads.boardArcs(project, recentWindow(now)), reads.holds(project), reads.prCutover?.(project)]);
  return { arcs: [...arcs], waits: { ...waits }, heldOn: { ...heldOn }, waitsFor: { ...waitsFor }, ...(cutover ? { cutover } : {}) };
}
