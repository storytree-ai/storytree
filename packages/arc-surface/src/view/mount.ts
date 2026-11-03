/** Capability 3 · Arc surface. */
import type { BoardReads } from "../board/reads.js";
import { isBoardSnapshot, watchBoard, type BoardState } from "../board/live-board.js";
import { pageKept } from "../live-reading/kept.js";
import type { BoardScope } from "../board/board.js";
import type { ClosedRange } from "../board/closed-range.js";
import type { ArcDrawn } from "../board/smoke.js";
import type { Timers } from "../live-reading/live-reading.js";
import type { PageReading } from "../live-reading/page-reading.js";
import { copyIcon, renderBoard, renderCard, waitingOnYou } from "./render.js";
import { readPreferences, writePreferences } from "./preferences.js";

export interface ArcSurface { stop(): void }
/**
 * The Arcs tab of the app's left rail (3.1): its lanes fill `host`, read for as long as it is mounted, whichever tab is on
 * show, and an arc's card opens over the map only when its row is clicked. `onFreshDraw` is told once, when the surface first
 * draws a board read fresh since this mount (3.18), which the app times from its start; `onWaiting` hears what waits on the
 * owner across the active arcs, the Arcs tab's badge.
 */
export function mountArcSurface(host: HTMLElement, options: { project: string; reads: BoardReads; timers?: Timers; reading?: PageReading; onFreshDraw?: () => void; onWaiting?: (count: number) => void }): ArcSurface {
  const root = document.createElement("div");
  root.className = "arc-surface-mount";
  root.innerHTML = `<section class="arc-rail" aria-label="Arcs" data-surface-id="arcs" data-surface-layer="panel"><div class="arc-status" role="status"></div><div class="arc-body"></div></section>`
    + `<aside class="arc-card" aria-label="Arc briefing" data-surface-id="arcs" data-surface-layer="overlay" hidden><button type="button" class="arc-card-close" data-close-card aria-label="Close this arc's detail" title="Close">×</button><div class="arc-briefing"></div></aside>`;
  host.append(root);
  const rail = root.querySelector<HTMLElement>(".arc-rail")!;
  const body = root.querySelector<HTMLElement>(".arc-body")!;
  const status = root.querySelector<HTMLElement>(".arc-status")!;
  const card = root.querySelector<HTMLElement>(".arc-card")!;
  const briefingPane = root.querySelector<HTMLElement>(".arc-briefing")!;
  let scope = readPreferences(options.project).scope;
  /** The arc whose card is open, by its click; none at mount, so nothing opens on its own (5.1). */
  let opened: string | undefined;
  let closedRange: ClosedRange = { preset: "today" };
  let question: string | undefined;
  let state: BoardState | undefined;
  /** Whether a board was read fresh since this mount. */
  let readFresh = false;
  /** The lanes' and the card's HTML as last written. */
  let drawn: string | undefined;
  let drawnCard: string | undefined;
  let drawnKey: string | undefined;
  let waiting: number | undefined;
  const folds = new Set<string>();
  const queues = new Set<string>();
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
    const lane = next.board.lanes.find(({ id }) => id === opened);
    if (!lane) { opened = undefined; question = undefined; }
    if (question && !lane?.view.questions.some(({ id }) => id === question)) question = undefined;
    if (next.board.scope === "active") {
      const count = waitingOnYou(next.board);
      if (count !== waiting) { waiting = count; options.onWaiting?.(count); }
    }
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusAttributes = ["data-arc-select", "data-arc-scope", "data-arc-queue", "data-closed-range", "data-question-open", "data-question-back"];
    const focusAttribute = focusAttributes.find((name) => focused?.hasAttribute(name));
    const focusKey = focusAttribute ? focused?.getAttribute(focusAttribute) : undefined;
    const focusedFold = focused?.tagName === "SUMMARY" ? focused.parentElement?.dataset.foldKey : undefined;
    // The lanes keep their place while the scope holds; the card keeps its own while it shows the same arc and question.
    const lanesTop = sameScope ? body.querySelector(".arc-lanes")?.scrollTop ?? 0 : 0;
    const cardKey = `${opened}\0${question}`;
    const cardTop = cardKey === drawnKey ? card.scrollTop : 0;
    drawnKey = cardKey;
    // 3.20: a refresh that changes nothing keeps its nodes, so a selection in the card holds.
    const html = renderBoard(next.board, opened, queues);
    if (html !== drawn) { body.innerHTML = html; drawn = html; }
    const cardHtml = opened ? renderCard(next.board, opened, question) : "";
    if (cardHtml !== drawnCard) { briefingPane.innerHTML = cardHtml; drawnCard = cardHtml; }
    card.hidden = !opened;
    for (const detail of root.querySelectorAll<HTMLDetailsElement>("details[data-fold-key]")) detail.open = folds.has(detail.dataset.foldKey!);
    if (focusAttribute) [...root.querySelectorAll<HTMLElement>("button")].find((button) => button.getAttribute(focusAttribute) === focusKey)?.focus({ preventScroll: true });
    if (focusedFold) [...root.querySelectorAll<HTMLElement>("details[data-fold-key]")].find((detail) => detail.dataset.foldKey === focusedFold)?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    const lanes = body.querySelector(".arc-lanes");
    if (lanes) lanes.scrollTop = lanesTop;
    card.scrollTop = cardTop;
    sayDrawn({
      arcs: [...new Set([...body.querySelectorAll<HTMLElement>("[data-arc-id]")].map((node) => node.dataset.arcId!))],
      increments: [...new Set([...body.querySelectorAll<HTMLElement>("[data-increment-id]")].map((node) => node.dataset.incrementId!))],
      holders: [...body.querySelectorAll<HTMLElement>("[data-agent-session]")].map((node) => ({ work: node.dataset.workId!, session: node.dataset.agentSession!, label: node.dataset.agentLabel! })),
    });
    if (firstFresh) options.onFreshDraw?.();
  }
  /** Close the open card, its arc's row taking the focus back. */
  function closeCard(): void {
    const was = opened;
    if (!was) return;
    opened = undefined; question = undefined;
    if (state) draw(state);
    card.hidden = true;
    [...body.querySelectorAll<HTMLButtonElement>("[data-arc-select]")].find((button) => button.dataset.arcSelect === was)?.focus({ preventScroll: true });
  }
  const watching = watchBoard({ ...options, kept: pageKept(`storytree.arc-surface.board.v1:${options.project}`, isBoardSnapshot), scope, keptFresh: false, closedRange, onState: draw });
  const surface: ArcSurface = {
    stop() { watching.stop(); document.removeEventListener("keydown", onKey); sayDrawn(); root.remove(); },
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && opened) { event.preventDefault(); closeCard(); }
  }
  document.addEventListener("keydown", onKey);
  card.querySelector("[data-close-card]")!.addEventListener("click", closeCard);
  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.hasAttribute("data-copy-arc-title")) copyTitle(button);
    // A row's click opens its arc's card, or closes it when it is the one open (5.1).
    if (button.dataset.arcSelect) {
      if (opened === button.dataset.arcSelect) return closeCard();
      opened = button.dataset.arcSelect; question = undefined;
      if (state) draw(state);
    }
    if (button.dataset.arcScope) { scope = button.dataset.arcScope as BoardScope; opened = undefined; question = undefined; card.hidden = true; watching.setScope(scope); remember(); }
    if (button.dataset.closedRange) { closedRange = { preset: button.dataset.closedRange as "today" | "yesterday" | "week" }; opened = undefined; question = undefined; card.hidden = true; watching.setClosedRange(closedRange); }
    if (button.dataset.arcQueue) {
      const id = button.dataset.arcQueue;
      if (queues.has(id)) queues.delete(id); else queues.add(id);
      if (state) draw(state);
    }
    if (button.dataset.questionOpen) {
      question = button.dataset.questionOpen;
      if (state) draw(state);
      card.querySelector<HTMLButtonElement>("[data-question-back]")?.focus({ preventScroll: true });
    }
    if (button.hasAttribute("data-question-back")) {
      const previous = question; question = undefined;
      if (state) draw(state);
      [...card.querySelectorAll<HTMLButtonElement>("[data-question-open]")].find((node) => node.dataset.questionOpen === previous)?.focus({ preventScroll: true });
    }
  });
  // 3.20: the picked arc's title goes to the clipboard as plain text, acknowledged on its button.
  function copyTitle(button: HTMLButtonElement): void {
    const title = state?.board?.lanes.find(({ id }) => id === opened)?.title;
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
    opened = undefined; question = undefined; card.hidden = true; watching.setClosedRange(closedRange);
  });
  root.addEventListener("toggle", (event) => {
    const detail = event.target as HTMLDetailsElement;
    if (!detail.isConnected || !detail.dataset.foldKey) return;
    if (detail.open) folds.add(detail.dataset.foldKey); else folds.delete(detail.dataset.foldKey);
  }, true);
  return surface;
}
