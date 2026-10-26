/** Capability 3 · Arc surface. */
import type { LogReading } from "@storytree/session-management/readings";
import type { Line } from "@storytree/library";
import type { Kept } from "../live-reading/kept.js";
import type { Timers } from "../live-reading/live-reading.js";
import { pageReading, type PageReading } from "../live-reading/page-reading.js";
import { boardView, type BoardScope, type BoardSnapshot, type BoardView } from "./board.js";
import { covers, dayOf, recentWindow, windowOf, type ClosedRange } from "./closed-range.js";
import { readBoard, type BoardReads } from "./reads.js";

/** "refreshing": the kept last board, drawn before this start's first read lands. */
export interface BoardState { status: "loading" | "refreshing" | "ready" | "error"; board?: BoardView; error?: string }
export interface WatchBoardOptions { project: string; reads: BoardReads; timers?: Timers; kept?: Kept<BoardSnapshot>; /** The scope drawn first, so a kept board opens at the saved scope. */ scope?: BoardScope; onState(state: BoardState): void;
  /** Whether the kept board was read fresh earlier on this page (a reopened drawer): it is drawn ready, not refreshing. */ keptFresh?: boolean;
  /** The Closed tab's range drawn first; Today unless given (3.12). */ closedRange?: ClosedRange;
  /** The page's one live reading, which the board hears; without it the board reads for itself. */ reading?: PageReading }

/** The records the board's work reading is made of: a change to any other leaves it as it was. */
const WORK_TYPES: ReadonlySet<string> = new Set(["arc", "increment", "question"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Whether a kept value has a board snapshot's shape, so one kept by an older build is not drawn. */
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  return isRecord(value) && Array.isArray(value.arcs) && isRecord(value.waits) && isRecord(value.heldOn)
    && value.arcs.every((view) => isRecord(view) && isRecord(view.arc) && Array.isArray(view.increments) && Array.isArray(view.questions) && typeof view.state === "string");
}

export function watchBoard({ project, reads, timers, kept, scope: startScope = "active", onState, reading: page, keptFresh = false, closedRange = { preset: "today" } }: WatchBoardOptions) {
  let snapshot = kept?.read();
  let fresh = keptFresh && snapshot !== undefined;
  let log: readonly Line[] | LogReading = [];
  let now = timers?.now() ?? Date.now();
  let scope: BoardScope = startScope;
  let stopped = false;
  let error: string | undefined;
  let quietMs: number | undefined;
  let range = closedRange;
  // 3.12: a Closed range past the routine read's two days is asked for whole, and never kept.
  let rangeAsked: { key: string; arcs?: BoardSnapshot["arcs"] } | undefined;
  const keyOf = ({ from, to }: { from: string; to: string }) => `${from}/${to}`;
  const closedArcs = (shown: BoardSnapshot): { arcs: BoardSnapshot["arcs"]; reading: boolean } => {
    const window = windowOf(range, now);
    if (covers(recentWindow(now), window)) return { arcs: shown.arcs.filter(({ closed }) => closed !== undefined && closed >= window.from && closed < window.to), reading: false };
    return rangeAsked?.key === keyOf(window) && rangeAsked.arcs ? { arcs: rangeAsked.arcs, reading: false } : { arcs: [], reading: true };
  };
  const askClosed = () => {
    const window = windowOf(range, now);
    if (scope !== "closed" || covers(recentWindow(now), window) || rangeAsked?.key === keyOf(window)) return;
    const key = keyOf(window);
    rangeAsked = { key };
    reads.closedArcs(project, window).then((arcs) => {
      if (rangeAsked?.key !== key) return;
      rangeAsked = { key, arcs: [...arcs] }; error = undefined; draw();
    }, (cause: unknown) => {
      if (rangeAsked?.key !== key) return;
      rangeAsked = undefined; error = cause instanceof Error ? cause.message : String(cause); draw();
    });
  };
  const viewOf = (shown: BoardSnapshot): BoardView => {
    if (scope !== "closed") return boardView(shown, log, new Date(now), scope, quietMs);
    const { arcs, reading } = closedArcs(shown);
    const window = windowOf(range, now);
    return { ...boardView({ ...shown, arcs }, log, new Date(now), scope, quietMs), closed: { range, from: window.from, to: dayOf(Date.parse(`${window.to}T12:00:00`), -1), reading } };
  };
  const draw = () => {
    if (stopped) return;
    const board = snapshot ? { board: viewOf(snapshot) } : {};
    onState(error ? { status: "error", ...board, error } : !snapshot ? { status: "loading" } : { status: fresh ? "ready" : "refreshing", ...board });
  };
  draw();
  const own = page === undefined ? pageReading({ project, reads, ...(timers ? { timers } : {}) }) : undefined;
  const reading = page ?? own!;
  // Each read of the work is numbered, so one that lands after a later one is not drawn over it.
  let asked = 0;
  let landed = 0;
  /** Read the work and draw it fresh; a failed read leaves the next news to read again. */
  const readWork = async (): Promise<void> => {
    const ask = ++asked;
    const [next, idleAfter] = await Promise.all([readBoard(project, reads, timers?.now() ?? Date.now()),
      // An unreadable setting keeps the last one read; the next news tries again.
      reads.idleAfterMs?.().catch(() => undefined)]);
    if (stopped || ask < landed) return;
    landed = ask; snapshot = next; fresh = true; kept?.write(next);
    quietMs = idleAfter ?? quietMs;
    log = reading.held(); now = timers?.now() ?? Date.now(); error = undefined; draw();
  };
  // The board reads its own work at once (3.9), rather than waiting on the page reading's first read,
  // which may be the whole history; news the page already held when it opened is in that read.
  const since = reading.held().changes.at(-1)?.seq ?? 0;
  let failed = false;
  void readWork().catch((cause) => { failed = true; if (!stopped) { error = cause instanceof Error ? cause.message : String(cause); draw(); } });
  const stopHearing = reading.subscribe({
    onNews: async (news) => {
      // The work is read again only for news that changes it (3.9): each read is every arc and hold.
      // News that fails to be heard comes back joined with the next, so none is lost.
      const rereads = failed || news.changes.some((change) => change.seq > since && WORK_TYPES.has(change.type));
      if (rereads) { await readWork(); failed = false; return; }
      quietMs = await reads.idleAfterMs?.().catch(() => undefined) ?? quietMs;
      if (stopped) return;
      log = reading.held(); now = timers?.now() ?? Date.now(); error = undefined; draw();
    },
    onClock: (at) => { now = at; draw(); },
    onError: (cause) => { error = cause instanceof Error ? cause.message : String(cause); draw(); },
  });
  return {
    setScope(next: BoardScope) { scope = next; askClosed(); draw(); },
    setClosedRange(next: ClosedRange) { range = next; askClosed(); draw(); },
    stop() { stopped = true; stopHearing(); own?.stop(); } };
}
