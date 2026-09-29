import type { AnnotatedTree, ArcView, Holds } from "@storytree/library";
import type { LiveReads } from "../live-reading/live-reading.js";
import type { BoardSnapshot } from "./board.js";

/** Read-only calls carried by the app. Whether a wait/question holds remains the library's answer. */
export interface BoardReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  arcView(project: string, id: string): Promise<ArcView | null>;
  /** Every hold on the project's live work in one reading: one ask per refresh, never one per arc or increment. */
  holds(project: string): Promise<Holds>;
  /** The user's idle-after setting in milliseconds, read now; without it a holder reads idle after 30 minutes. */
  idleAfterMs?(): Promise<number>;
}
export async function readBoard(project: string, reads: BoardReads): Promise<BoardSnapshot> {
  const tree = await reads.projectTree(project);
  const [views, { waits, heldOn }] = await Promise.all([
    Promise.all(tree.arcs.map(({ id }) => reads.arcView(project, id))),
    reads.holds(project),
  ]);
  const arcs = views.filter((view): view is ArcView => view !== null);
  return { arcs, waits: { ...waits }, heldOn: { ...heldOn } };
}
