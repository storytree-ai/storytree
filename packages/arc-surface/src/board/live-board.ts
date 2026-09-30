import type { Line } from "@storytree/agent-link";
import type { Kept } from "../live-reading/kept.js";
import { liveReading, type Timers } from "../live-reading/live-reading.js";
import { boardView, type BoardScope, type BoardSnapshot, type BoardView } from "./board.js";
import { readBoard, type BoardReads } from "./reads.js";

/** "refreshing": the kept last board, drawn before this start's first read lands. */
export interface BoardState { status: "loading" | "refreshing" | "ready" | "error"; board?: BoardView; error?: string }
export interface WatchBoardOptions { project: string; reads: BoardReads; timers?: Timers; kept?: Kept<BoardSnapshot>; /** The scope drawn first, so a kept board opens at the saved scope. */ scope?: BoardScope; onState(state: BoardState): void }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Whether a kept value has a board snapshot's shape, so one kept by an older build is not drawn. */
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  return isRecord(value) && Array.isArray(value.arcs) && isRecord(value.waits) && isRecord(value.heldOn)
    && value.arcs.every((view) => isRecord(view) && isRecord(view.arc) && Array.isArray(view.increments) && Array.isArray(view.questions) && typeof view.state === "string");
}

export function watchBoard({ project, reads, timers, kept, scope: startScope = "active", onState }: WatchBoardOptions) {
  let snapshot = kept?.read();
  let fresh = false;
  let lines: Line[] = [];
  let now = timers?.now() ?? Date.now();
  let scope: BoardScope = startScope;
  let stopped = false;
  let error: string | undefined;
  let quietMs: number | undefined;
  const draw = () => {
    if (stopped) return;
    const board = snapshot ? { board: boardView(snapshot, lines, new Date(now), scope, quietMs) } : {};
    onState(error ? { status: "error", ...board, error } : !snapshot ? { status: "loading" } : { status: fresh ? "ready" : "refreshing", ...board });
  };
  draw();
  const reading = liveReading({ project, reads, ...(timers ? { timers } : {}),
    onNews: async (news) => {
      const [next, idleAfter] = await Promise.all([readBoard(project, reads),
        // An unreadable setting keeps the last one read; the next news tries again.
        reads.idleAfterMs?.().catch(() => undefined)]);
      if (stopped) return;
      snapshot = next; fresh = true; kept?.write(next); quietMs = idleAfter ?? quietMs;
      lines = [...lines, ...news.lines]; now = timers?.now() ?? Date.now(); error = undefined; draw();
    },
    onClock: (at) => { now = at; draw(); },
    onError: (cause) => { error = cause instanceof Error ? cause.message : String(cause); draw(); },
  });
  return { setScope(next: BoardScope) { scope = next; draw(); }, stop() { stopped = true; reading.stop(); } };
}
