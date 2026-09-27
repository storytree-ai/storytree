import type { Line } from "@storytree/agent-link";
import { liveReading, type Timers } from "../live-reading/live-reading.js";
import { boardView, type BoardScope, type BoardSnapshot, type BoardView } from "./board.js";
import { readBoard, type BoardReads } from "./reads.js";

export interface BoardState { status: "loading" | "ready" | "error"; board?: BoardView; error?: string }
export interface WatchBoardOptions { project: string; reads: BoardReads; timers?: Timers; onState(state: BoardState): void }
export function watchBoard({ project, reads, timers, onState }: WatchBoardOptions) {
  let snapshot: BoardSnapshot | undefined;
  let lines: Line[] = [];
  let now = timers?.now() ?? Date.now();
  let scope: BoardScope = "active";
  let stopped = false;
  let error: string | undefined;
  const draw = () => {
    if (stopped) return;
    const board = snapshot ? { board: boardView(snapshot, lines, new Date(now), scope) } : {};
    onState(error ? { status: "error", ...board, error } : snapshot ? { status: "ready", ...board } : { status: "loading" });
  };
  draw();
  const reading = liveReading({ project, reads, ...(timers ? { timers } : {}),
    onNews: async (news) => {
      const next = await readBoard(project, reads);
      if (stopped) return;
      snapshot = next; lines = [...lines, ...news.lines]; now = timers?.now() ?? Date.now(); error = undefined; draw();
    },
    onClock: (at) => { now = at; draw(); },
    onError: (cause) => { error = cause instanceof Error ? cause.message : String(cause); draw(); },
  });
  return { setScope(next: BoardScope) { scope = next; draw(); }, stop() { stopped = true; reading.stop(); } };
}
