/** Capability 3 · Arc surface. */
import type { BoardReads } from "../board/reads.js";
import { isBoardSnapshot, watchBoard, type BoardState } from "../board/live-board.js";
import { pageKept } from "../live-reading/kept.js";
import { openCapabilities, openContracts, type BoardScope } from "../board/board.js";
import type { BoardView } from "../board/board.js";
import type { ClosedRange } from "../board/closed-range.js";
import type { ArcDrawn } from "../board/smoke.js";
import { pageTimers, type Timers } from "../live-reading/live-reading.js";
import type { CiExpected } from "../board/ci-bars.js";
import type { PageReading } from "../live-reading/page-reading.js";
import { copyIcon, renderBoard, renderCiBars } from "./render.js";
import { readPreferences, writePreferences } from "./preferences.js";
import type { ArcQueue } from "../waits/waits.js";

export interface ArcSurface {
  stop(): void;
  /**
   * Show increment `id` (3.39): its arc selected, the queue head it waits behind opened, its row open and scrolled into view. Asked
   * before a board shows it, it waits for the draw that does.
   */
  openIncrement(id: string): void;
}
/** Whether `queue` is the arc `arc` or holds it queued behind it, however deep. */
const holds = (queue: ArcQueue, arc: string): boolean => queue.arc.id === arc || queue.queued.some((queued) => holds(queued, arc));
/** How often the CI legs' factory medians are read again (3.34): the recorder adds a run's time at most this often. */
const EXPECTED_EVERY_MS = 10 * 60_000;
/**
 * The Arcs tab of the app's left rail (3.1): its lanes fill `host`, read for as long as it is mounted, whichever tab is on
 * show; an arc's row, clicked, selects it and opens its expansion under the row, and nothing opens over the map. `onFreshDraw` is told once, when the surface first
 * draws a board read fresh since this mount (3.18), which the app times from its start; `onWaiting` hears what waits on the
 * owner across the active arcs, the Arcs tab's badge. Given `startAfter`, the page's start, it reads nothing until that settles (3.9).
 * `onOpened` hears the capabilities the selected arc's open increments name, and the contracts they link, once each, whenever they
 * change, and undefined once no arc is selected (3.27), which the map circles (ADR-1253 D1) and rings the gates of (ADR-1279 D4).
 * `ciExpected` reads each CI leg's factory median (CI health 6.7), once mounted and every ten minutes, which a pull request's
 * CI bar is drawn against (3.34); the clock that moves the board moves its fill.
 */
export function mountArcSurface(host: HTMLElement, options: { project: string; reads: BoardReads; timers?: Timers; reading?: PageReading; startAfter?: PromiseLike<unknown>; onFreshDraw?: () => void; onWaiting?: (count: number) => void; onOpened?: (capabilities: readonly string[] | undefined, contracts: readonly string[] | undefined) => void; ciExpected?: () => PromiseLike<CiExpected | undefined> }): ArcSurface {
  const root = document.createElement("div");
  root.className = "arc-surface-mount";
  root.innerHTML = `<section class="arc-rail" aria-label="Arcs" data-surface-id="arcs"><div class="arc-status" role="status"></div><div class="arc-body"></div></section>`;
  host.append(root);
  const rail = root.querySelector<HTMLElement>(".arc-rail")!;
  const body = root.querySelector<HTMLElement>(".arc-body")!;
  const status = root.querySelector<HTMLElement>(".arc-status")!;
  let scope = readPreferences(options.project).scope;
  /** The arc selected by its row's click; none at mount, so nothing is selected on its own (3.7). */
  let opened: string | undefined;
  let closedRange: ClosedRange = { preset: "today" };
  let state: BoardState | undefined;
  /** Whether a board was read fresh since this mount. */
  let readFresh = false;
  /** The lanes' HTML as last written, their CI bars left out. */
  let drawn: string | undefined;
  /** Each lane's CI bars as last written into their holder, by arc (3.34). */
  const ciDrawn = new Map<string, string>();
  let waiting: number | undefined;
  /** What `onOpened` was last told, as a key, so a refresh that changes nothing tells nothing. */
  let toldOpened: string | undefined;
  const tellOpened = (work: { capabilities: readonly string[]; contracts: readonly string[] } | undefined): void => {
    const key = work === undefined ? undefined : JSON.stringify(work);
    if (key === toldOpened) return;
    toldOpened = key;
    options.onOpened?.(work?.capabilities, work?.contracts);
  };
  const folds = new Set<string>();
  /** How many ovals one row of a strip holds at the rail's width, as last measured: a 16 px oval and its 3 px gap (3.2). */
  let perRow: number | undefined;
  const measure = () => {
    const width = body.querySelector<HTMLElement>(".arc-lane .arc-bars")?.clientWidth ?? 0;
    return width > 0 ? Math.floor((width + 3) / 19) : perRow;
  };
  const queues = new Set<string>();
  /** The increment asked to be shown and not drawn yet (3.39). */
  let asked: string | undefined;
  /** Selects the asked increment's arc and opens its queue head and its row, once the board holds it; returns its row's fold key. */
  const take = (board: BoardView): string | undefined => {
    const id = asked;
    const lane = id === undefined ? undefined : board.lanes.find(({ view }) => view.increments.some((work) => work.id === id));
    if (!lane) return undefined;
    asked = undefined;
    opened = lane.id;
    const head = board.queues.find((queue) => holds(queue, lane.id));
    if (head) queues.add(head.arc.id);
    const key = `rail:${lane.id}:increment:${id}`;
    folds.add(key);
    return key;
  };
  const remember = () => writePreferences(options.project, { scope });
  const sayDrawn = (drawn?: ArcDrawn) => {
    const current = JSON.parse(document.body.dataset.drew ?? "{}");
    if (drawn) current.arcSurface = drawn; else delete current.arcSurface;
    document.body.dataset.drew = JSON.stringify(current);
  };
  function draw(next: BoardState): void {
    const sameScope = state?.board?.scope === next.board?.scope;
    state = next;
    const firstFresh = next.status === "ready" && !readFresh;
    if (next.status === "ready") readFresh = true;
    rail.dataset.arcState = next.status;
    status.textContent = next.status === "loading" ? "Reading arcs…" : next.status === "refreshing" ? "Showing the arcs as last read. Refreshing…"
      : next.status === "error" ? `Arcs could not be read: ${next.error}. Retrying…` : "";
    status.setAttribute("role", next.status === "error" ? "alert" : "status");
    // A failed read retains the last good board, explicitly stale.
    if (!next.board) return;
    const shown = take(next.board);
    const lane = next.board.lanes.find(({ id }) => id === opened);
    if (!lane) opened = undefined;
    tellOpened(lane === undefined ? undefined : { capabilities: openCapabilities(lane.view), contracts: openContracts(lane.view) });
    if (next.waiting !== undefined && next.waiting !== waiting) { waiting = next.waiting; options.onWaiting?.(waiting); }
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusAttributes = ["data-arc-select", "data-arc-scope", "data-arc-queue", "data-closed-range", "data-copy-arc-title"];
    const focusAttribute = focusAttributes.find((name) => focused?.hasAttribute(name));
    const focusKey = focusAttribute ? focused?.getAttribute(focusAttribute) : undefined;
    const focusedFold = focused?.tagName === "SUMMARY" ? focused.parentElement?.dataset.foldKey : undefined;
    // The lanes keep their place while the scope holds.
    const lanesTop = sameScope ? body.querySelector(".arc-lanes")?.scrollTop ?? 0 : 0;
    // 3.20: a refresh that changes nothing keeps its nodes, so a selection in the expansion holds.
    // 3.34: the CI bars are written into their own holders, so the clock and the medians' read move them and nothing else.
    const write = () => {
      const html = renderBoard(next.board!, opened, queues, perRow, true);
      if (html !== drawn) { body.innerHTML = html; drawn = html; ciDrawn.clear(); }
      for (const holder of body.querySelectorAll<HTMLElement>("[data-ci-lane]")) {
        const id = holder.dataset.ciLane!;
        const lane = next.board!.lanes.find((one) => one.id === id);
        const bars = lane ? renderCiBars(lane) : "";
        if (ciDrawn.get(id) !== bars) { holder.innerHTML = bars; ciDrawn.set(id, bars); }
      }
    };
    write();
    // A strip is cut to the width it is drawn at, so a first draw, or one at a new width, is drawn again once measured.
    const measured = measure();
    if (measured !== perRow) { perRow = measured; write(); }
    // An increment shown from outside opens the folds it sits in too: a landed one's sits in the landed fold.
    const row = shown === undefined ? undefined : [...root.querySelectorAll<HTMLDetailsElement>("details[data-fold-key]")].find((detail) => detail.dataset.foldKey === shown);
    for (let fold = row?.parentElement?.closest<HTMLElement>("details[data-fold-key]"); fold; fold = fold.parentElement?.closest<HTMLElement>("details[data-fold-key]")) folds.add(fold.dataset.foldKey!);
    for (const detail of root.querySelectorAll<HTMLDetailsElement>("details[data-fold-key]")) detail.open = folds.has(detail.dataset.foldKey!);
    if (focusAttribute) [...root.querySelectorAll<HTMLElement>("button")].find((button) => button.getAttribute(focusAttribute) === focusKey)?.focus({ preventScroll: true });
    if (focusedFold) [...root.querySelectorAll<HTMLElement>("details[data-fold-key]")].find((detail) => detail.dataset.foldKey === focusedFold)?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    const lanes = body.querySelector(".arc-lanes");
    if (lanes) lanes.scrollTop = lanesTop;
    row?.scrollIntoView?.({ block: "nearest" });
    const folded = [...body.querySelectorAll<HTMLElement>("[data-folded-ids]")].flatMap((node) => node.dataset.foldedIds!.split(" "));
    sayDrawn({
      arcs: [...new Set([...body.querySelectorAll<HTMLElement>("[data-arc-id]")].map((node) => node.dataset.arcId!))],
      increments: [...new Set([...body.querySelectorAll<HTMLElement>("[data-increment-id]")].map((node) => node.dataset.incrementId!).concat(folded))],
      holders: [...body.querySelectorAll<HTMLElement>("[data-agent-session]")].map((node) => ({ work: node.dataset.workId!, session: node.dataset.agentSession!, label: node.dataset.agentLabel! })),
      ...(folded.length ? { folded } : {}),
    });
    if (firstFresh) options.onFreshDraw?.();
  }
  const resizes = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (state && measure() !== perRow) draw(state); }) : undefined;
  resizes?.observe(body);
  const watching = watchBoard({ ...options, kept: pageKept(`storytree.arc-surface.board.v1:${options.project}`, isBoardSnapshot), scope, closedRange, onState: draw });
  // 3.34: an unreadable median keeps the last one read; the next read tries again.
  const readExpected = () => { if (options.ciExpected) void Promise.resolve(options.ciExpected()).then((read) => { if (read) watching.setExpected(read); }, () => undefined); };
  readExpected();
  const stopExpected = options.ciExpected ? (options.timers ?? pageTimers).every(EXPECTED_EVERY_MS, readExpected) : () => undefined;
  const surface: ArcSurface = {
    stop() { watching.stop(); stopExpected(); resizes?.disconnect(); sayDrawn(); root.remove(); },
    openIncrement(id) { asked = id; if (state) draw(state); },
  };
  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.hasAttribute("data-copy-arc-title")) copyTitle(button);
    // 3.21: a row's click selects its arc and opens its expansion, or, on the selected row, deselects and closes it; a queued
    // arc's chip selects it, its expansion drawn under the chips (4.1).
    const picked = button.dataset.arcSelect;
    if (picked) {
      const row = button.classList.contains("arc-lane");
      if (opened === picked) { opened = undefined; if (row) queues.delete(picked); }
      else { opened = picked; if (row) queues.add(picked); }
      if (state) draw(state);
    }
    if (button.dataset.arcScope) { scope = button.dataset.arcScope as BoardScope; opened = undefined; watching.setScope(scope); remember(); }
    if (button.dataset.closedRange) { closedRange = { preset: button.dataset.closedRange as "today" | "yesterday" | "week" }; opened = undefined; watching.setClosedRange(closedRange); }
    if (button.dataset.arcQueue) {
      const id = button.dataset.arcQueue;
      if (queues.has(id)) queues.delete(id); else queues.add(id);
      if (state) draw(state);
    }
  });
  // 3.20: the arc's title goes to the clipboard as plain text, acknowledged on its button.
  function copyTitle(button: HTMLButtonElement): void {
    const title = state?.board?.lanes.find(({ id }) => id === button.dataset.copyArcTitle)?.title;
    if (!title) return;
    const say = (text: string) => {
      button.textContent = text;
      setTimeout(() => { if (button.isConnected) button.innerHTML = copyIcon; }, 1500);
    };
    void Promise.resolve().then(() => navigator.clipboard.writeText(title)).then(() => say("Copied"), () => say("Copy failed"));
  }
  // 3.12: a From–to day picked asks for that range, its other end kept as shown.
  body.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches("[data-closed-from], [data-closed-to]") || !input.value) return;
    const shown = state?.board?.closed;
    if (!shown) return;
    closedRange = input.hasAttribute("data-closed-from") ? { from: input.value, to: shown.to } : { from: shown.from, to: input.value };
    opened = undefined; watching.setClosedRange(closedRange);
  });
  root.addEventListener("toggle", (event) => {
    const detail = event.target as HTMLDetailsElement;
    if (!detail.isConnected || !detail.dataset.foldKey) return;
    if (detail.open) folds.add(detail.dataset.foldKey); else folds.delete(detail.dataset.foldKey);
  }, true);
  return surface;
}
