// Capability 3 · Arc surface.
import type { LogReading } from "@storytree/session-management/readings";
import type { Line } from "@storytree/library";
import type { Kept } from "../live-reading/kept.js";
import type { Timers } from "../live-reading/live-reading.js";
import { pageReading, type PageReading } from "../live-reading/page-reading.js";
import { boardView, waitingOnYou, type BoardScope, type BoardSnapshot, type BoardView } from "./board.js";
import type { CiExpected } from "./ci-bars.js";
import { covers, dayOf, recentWindow, windowOf, type ClosedRange } from "./closed-range.js";
import { readBoard, type BoardReads } from "./reads.js";

export interface BoardState { status: "loading" | "refreshing" | "ready" | "error"; board?: BoardView; error?: string; waiting?: number }
export interface WatchBoardOptions { project: string; reads: BoardReads; timers?: Timers; kept?: Kept<BoardSnapshot>; scope?: BoardScope; onState(state: BoardState): void;
  closedRange?: ClosedRange;
  reading?: PageReading;
  startAfter?: PromiseLike<unknown> }

const WORK_TYPES: ReadonlySet<string> = new Set(["arc", "increment", "question"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  return isRecord(value) && Array.isArray(value.arcs) && isRecord(value.waits) && isRecord(value.heldOn)
    && value.arcs.every((view) => isRecord(view) && isRecord(view.arc) && Array.isArray(view.increments) && Array.isArray(view.questions) && typeof view.state === "string");
}

export function watchBoard({ project, reads, timers, kept, scope: startScope = "active", onState, reading: page, closedRange = { preset: "today" }, startAfter }: WatchBoardOptions) {
  let snapshot = kept?.read();
  let fresh = false;
  let log: readonly Line[] | LogReading = [];
  let now = timers?.now() ?? Date.now();
  let scope: BoardScope = startScope;
  let stopped = false;
  let error: string | undefined;
  let quietMs: number | undefined;
  let range = closedRange;
  let expected: CiExpected = {};
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
    if (scope !== "closed") return boardView(shown, log, new Date(now), scope, quietMs, expected);
    const { arcs, reading } = closedArcs(shown);
    const window = windowOf(range, now);
    return { ...boardView({ ...shown, arcs }, log, new Date(now), scope, quietMs), closed: { range, from: window.from, to: dayOf(Date.parse(`${window.to}T12:00:00`), -1), reading } };
  };
  const withWaiting = (shown: BoardSnapshot) => {
    const board = viewOf(shown);
    return { board, waiting: waitingOnYou(scope === "active" ? board : boardView(shown, log, new Date(now), "active", quietMs)) };
  };
  const draw = () => {
    if (stopped) return;
    const board = snapshot ? withWaiting(snapshot) : {};
    onState(error ? { status: "error", ...board, error } : !snapshot ? { status: "loading" } : { status: fresh ? "ready" : "refreshing", ...board });
  };
  draw();
  const own = page === undefined ? pageReading({ project, reads, ...(timers ? { timers } : {}) }) : undefined;
  const reading = page ?? own!;
  let asked = 0;
  let landed = 0;
  const readWork = async (): Promise<void> => {
    const ask = ++asked;
    const [next, idleAfter] = await Promise.all([readBoard(project, reads, timers?.now() ?? Date.now()),
      reads.idleAfterMs?.().catch(() => undefined)]);
    if (stopped || ask < landed) return;
    landed = ask; snapshot = next; fresh = true; kept?.write(next);
    quietMs = idleAfter ?? quietMs;
    log = reading.held(); now = timers?.now() ?? Date.now(); error = undefined; draw();
  };
  let stopHearing = (): void => {};
  const begin = (): void => {
    if (stopped) return;
    const since = reading.held().changes.at(-1)?.seq ?? 0;
    let failed = false;
    void readWork().catch((cause) => { failed = true; if (!stopped) { error = cause instanceof Error ? cause.message : String(cause); draw(); } });
    stopHearing = reading.subscribe({
      onNews: async (news) => {
        const rereads = failed || news.changes.some((change) => change.seq > since && WORK_TYPES.has(change.type));
        if (rereads) { await readWork(); failed = false; return; }
        quietMs = await reads.idleAfterMs?.().catch(() => undefined) ?? quietMs;
        if (stopped) return;
        log = reading.held(); now = timers?.now() ?? Date.now(); error = undefined; draw();
      },
      onClock: (at) => { now = at; draw(); },
      onError: (cause) => { error = cause instanceof Error ? cause.message : String(cause); draw(); },
    });
  };
  if (startAfter === undefined) begin();
  else void Promise.resolve(startAfter).then(begin, begin);
  return {
    setScope(next: BoardScope) { scope = next; askClosed(); draw(); },
    setClosedRange(next: ClosedRange) { range = next; askClosed(); draw(); },
    setExpected(next: CiExpected) { expected = next; draw(); },
    stop() { stopped = true; stopHearing(); own?.stop(); } };
}
