// Capability 3 · Arc surface.
import type { BoardArcView, DayWindow, Holds, PrCutover } from "@storytree/library";
import type { LiveReads } from "../live-reading/live-reading.js";
import type { BoardSnapshot } from "./board.js";
import { recentWindow } from "./closed-range.js";

export interface BoardReads extends LiveReads {
  boardArcs(project: string, closed: DayWindow): Promise<readonly BoardArcView[]>;
  closedArcs(project: string, window: DayWindow): Promise<readonly BoardArcView[]>;
  holds(project: string): Promise<Holds>;
  idleAfterMs?(): Promise<number>;
  prCutover?(project: string): Promise<PrCutover | undefined>;
}
export async function readBoard(project: string, reads: BoardReads, now: number = Date.now()): Promise<BoardSnapshot> {
  const [arcs, { waits, heldOn, waitsFor }, cutover] = await Promise.all([reads.boardArcs(project, recentWindow(now)), reads.holds(project), reads.prCutover?.(project)]);
  return { arcs: [...arcs], waits: { ...waits }, heldOn: { ...heldOn }, waitsFor: { ...waitsFor }, ...(cutover ? { cutover } : {}) };
}
