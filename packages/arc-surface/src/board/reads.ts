/** Capability 3 · Arc surface. */
import type { ArcView, Holds } from "@storytree/library";
import type { LiveReads } from "../live-reading/live-reading.js";
import type { BoardSnapshot } from "./board.js";

/** Read-only calls carried by the app. Whether a wait/question holds remains the library's answer. */
export interface BoardReads extends LiveReads {
  /** Every live arc's view in one reading (library 7.8): one ask per refresh, never one per arc. */
  arcViews(project: string): Promise<readonly ArcView[]>;
  /** Every hold on the project's live work in one reading: one ask per refresh, never one per arc or increment. */
  holds(project: string): Promise<Holds>;
  /** The user's idle-after setting in milliseconds, read now; without it a holder reads idle after 30 minutes. */
  idleAfterMs?(): Promise<number>;
}
export async function readBoard(project: string, reads: BoardReads): Promise<BoardSnapshot> {
  const [arcs, { waits, heldOn, waitsFor }] = await Promise.all([reads.arcViews(project), reads.holds(project)]);
  return { arcs: [...arcs], waits: { ...waits }, heldOn: { ...heldOn }, waitsFor: { ...waitsFor } };
}
