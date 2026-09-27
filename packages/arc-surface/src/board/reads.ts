import type { AnnotatedTree, ArcView, Hold } from "@storytree/library";
import type { LiveReads } from "../live-reading/live-reading.js";
import type { BoardSnapshot } from "./board.js";

/** Read-only calls carried by the app. Whether a wait/question holds remains the library's answer. */
export interface BoardReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  arcView(project: string, id: string): Promise<ArcView | null>;
  waitHolds(project: string, id: string): Promise<Hold[]>;
  heldOnQuestion(project: string, id: string): Promise<string[]>;
}
export async function readBoard(project: string, reads: BoardReads): Promise<BoardSnapshot> {
  const tree = await reads.projectTree(project);
  const views = await Promise.all(tree.arcs.map(({ id }) => reads.arcView(project, id)));
  const arcs = views.filter((view): view is ArcView => view !== null);
  const increments = arcs.flatMap(({ increments }) => increments);
  const [waits, heldOn] = await Promise.all([
    Promise.all([...arcs.map(({ arc }) => arc.id), ...increments.map(({ id }) => id)].map(async (id) => [id, await reads.waitHolds(project, id)] as const)),
    Promise.all(increments.map(async ({ id }) => [id, await reads.heldOnQuestion(project, id)] as const)),
  ]);
  return { arcs, waits: Object.fromEntries(waits), heldOn: Object.fromEntries(heldOn) };
}
