import type { Line, LogReading } from "@storytree/agent-link/readings";
import type { Kept } from "../live-reading/kept.js";
import type { Timers } from "../live-reading/live-reading.js";
import { pageReading, type PageReading } from "../live-reading/page-reading.js";
import { boardView, type BoardScope, type BoardSnapshot, type BoardView } from "./board.js";
import { readBoard, type BoardReads } from "./reads.js";

/** "refreshing": the kept last board, drawn before this start's first read lands. */
export interface BoardState { status: "loading" | "refreshing" | "ready" | "error"; board?: BoardView; error?: string }
export interface WatchBoardOptions { project: string; reads: BoardReads; timers?: Timers; kept?: Kept<BoardSnapshot>; /** The scope drawn first, so a kept board opens at the saved scope. */ scope?: BoardScope; onState(state: BoardState): void;
  /** The page's one live reading, which the board hears; without it the board reads for itself. */ reading?: PageReading }

/** The records the board's work reading is made of: a change to any other leaves it as it was. */
const WORK_TYPES: ReadonlySet<string> = new Set(["arc", "increment", "question"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Whether a kept value has a board snapshot's shape, so one kept by an older build is not drawn. */
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  return isRecord(value) && Array.isArray(value.arcs) && isRecord(value.waits) && isRecord(value.heldOn)
    && value.arcs.every((view) => isRecord(view) && isRecord(view.arc) && Array.isArray(view.increments) && Array.isArray(view.questions) && typeof view.state === "string");
}

export function watchBoard({ project, reads, timers, kept, scope: startScope = "active", onState, reading: page }: WatchBoardOptions) {
  let snapshot = kept?.read();
  let fresh = false;
  let log: readonly Line[] | LogReading = [];
  let now = timers?.now() ?? Date.now();
  let scope: BoardScope = startScope;
  let stopped = false;
  let error: string | undefined;
  let quietMs: number | undefined;
  const draw = () => {
    if (stopped) return;
    const board = snapshot ? { board: boardView(snapshot, log, new Date(now), scope, quietMs) } : {};
    onState(error ? { status: "error", ...board, error } : !snapshot ? { status: "loading" } : { status: fresh ? "ready" : "refreshing", ...board });
  };
  draw();
  const own = page === undefined ? pageReading({ project, reads, ...(timers ? { timers } : {}) }) : undefined;
  const reading = page ?? own!;
  const stopHearing = reading.subscribe({
    onNews: async (news) => {
      // The work is read again only for news that changes it, and at first (3.9): each read is every
      // arc and hold. News that fails to be heard comes back joined with the next, so none is lost.
      const rereads = !fresh || news.changes.some((change) => WORK_TYPES.has(change.type));
      const [next, idleAfter] = await Promise.all([rereads ? readBoard(project, reads) : snapshot,
        // An unreadable setting keeps the last one read; the next news tries again.
        reads.idleAfterMs?.().catch(() => undefined)]);
      if (stopped) return;
      if (rereads && next !== undefined) { snapshot = next; fresh = true; kept?.write(next); }
      quietMs = idleAfter ?? quietMs;
      log = reading.held(); now = timers?.now() ?? Date.now(); error = undefined; draw();
    },
    onClock: (at) => { now = at; draw(); },
    onError: (cause) => { error = cause instanceof Error ? cause.message : String(cause); draw(); },
  });
  return { setScope(next: BoardScope) { scope = next; draw(); }, stop() { stopped = true; stopHearing(); own?.stop(); } };
}
