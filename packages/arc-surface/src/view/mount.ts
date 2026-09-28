import type { BoardReads } from "../board/reads.js";
import { watchBoard, type BoardState } from "../board/live-board.js";
import type { BoardScope } from "../board/board.js";
import type { ArcDrawn } from "../board/smoke.js";
import type { Timers } from "../live-reading/live-reading.js";
import { renderBoard, renderHandle } from "./render.js";
import { readPreferences, writePreferences } from "./preferences.js";

export interface ArcSurface { open(): void; close(): void; stop(): void }
/** A nonmodal top drawer: its host and the forest below keep receiving input. */
export function mountArcSurface(host: HTMLElement, options: { project: string; reads: BoardReads; timers?: Timers }): ArcSurface {
  const root = document.createElement("div");
  root.className = "arc-surface-mount";
  root.innerHTML = `${renderHandle(options.project, false)}<section id="arc-drawer" class="arc-overlay" aria-label="Arc surface" hidden>${renderHandle(options.project, true)}<div class="arc-status" role="status"></div><div class="arc-body"></div></section>`;
  host.append(root);
  const launch = root.querySelector<HTMLButtonElement>("[data-open-arcs]")!;
  const drawer = root.querySelector<HTMLElement>(".arc-overlay")!;
  const body = root.querySelector<HTMLElement>(".arc-body")!;
  const status = root.querySelector<HTMLElement>(".arc-status")!;
  const saved = readPreferences(options.project);
  let scope = saved.scope;
  let picked = saved.picked;
  let question: string | undefined;
  let watching: ReturnType<typeof watchBoard> | undefined;
  let state: BoardState | undefined;
  const folds = new Set<string>();
  const queues = new Set<string>();
  const remember = () => writePreferences(options.project, { open: !drawer.hidden, scope, ...(picked ? { picked } : {}) });
  const sayDrawn = (drawn?: ArcDrawn) => {
    const current = JSON.parse(document.body.dataset.drew ?? "{}");
    if (drawn) current.arcSurface = drawn; else delete current.arcSurface;
    document.body.dataset.drew = JSON.stringify(current);
  };
  function draw(next: BoardState, preservePosition = true): void {
    const sameScope = state?.board?.scope === next.board?.scope;
    state = next;
    drawer.dataset.arcState = next.status;
    status.textContent = next.status === "loading" ? "Reading arcs…" : next.status === "error" ? `Arcs could not be read: ${next.error}. Retrying…` : "";
    status.setAttribute("role", next.status === "error" ? "alert" : "status");
    // A failed read retains the last good board, explicitly stale.
    if (!next.board) return;
    const selected = next.board.lanes.find(({ id }) => id === picked) ?? next.board.lanes.find(({ id }) => id === next.board!.selected);
    if (picked !== selected?.id) { picked = selected?.id; question = undefined; }
    if (question && !selected?.view.questions.some(({ id }) => id === question)) question = undefined;
    remember();
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusAttributes = ["data-arc-select", "data-arc-scope", "data-arc-queue", "data-question-open", "data-question-back"];
    const focusAttribute = focusAttributes.find((name) => focused?.hasAttribute(name));
    const focusKey = focusAttribute ? focused?.getAttribute(focusAttribute) : undefined;
    const focusedFold = focused?.tagName === "SUMMARY" ? focused.parentElement?.dataset.foldKey : undefined;
    const positions = [".arc-lanes", ".arc-briefing"].map((selector) => ({ selector, top: preservePosition && sameScope ? body.querySelector(selector)?.scrollTop ?? 0 : 0 }));
    body.innerHTML = renderBoard(next.board, picked, question, queues);
    for (const detail of body.querySelectorAll<HTMLDetailsElement>("details[data-fold-key]")) detail.open = folds.has(detail.dataset.foldKey!);
    if (focusAttribute) [...body.querySelectorAll<HTMLElement>("button")].find((button) => button.getAttribute(focusAttribute) === focusKey)?.focus({ preventScroll: true });
    if (focusedFold) [...body.querySelectorAll<HTMLElement>("details[data-fold-key]")].find((detail) => detail.dataset.foldKey === focusedFold)?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    for (const { selector, top } of positions) { const pane = body.querySelector(selector); if (pane) pane.scrollTop = top; }
    sayDrawn({
      arcs: [...new Set([...body.querySelectorAll<HTMLElement>("[data-arc-id]")].map((node) => node.dataset.arcId!))],
      increments: [...new Set([...body.querySelectorAll<HTMLElement>("[data-increment-id]")].map((node) => node.dataset.incrementId!))],
      holders: [...body.querySelectorAll<HTMLElement>("[data-agent-session]")].map((node) => ({ work: node.dataset.workId!, session: node.dataset.agentSession!, label: node.dataset.agentLabel! })),
    });
  }
  const surface: ArcSurface = {
    open() {
      if (!drawer.hidden) return;
      drawer.hidden = false; launch.hidden = true; launch.setAttribute("aria-expanded", "true");
      remember();
      watching = watchBoard({ ...options, onState: draw });
      watching.setScope(scope);
      drawer.querySelector<HTMLButtonElement>("[data-close-arcs]")!.focus();
    },
    close() {
      if (drawer.hidden) return;
      watching?.stop(); watching = undefined; drawer.hidden = true; launch.hidden = false;
      launch.setAttribute("aria-expanded", "false"); remember(); sayDrawn(); launch.focus();
    },
    stop() { watching?.stop(); watching = undefined; document.removeEventListener("keydown", onKey); sayDrawn(); root.remove(); },
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !drawer.hidden) { event.preventDefault(); surface.close(); }
  }
  document.addEventListener("keydown", onKey);
  launch.addEventListener("click", surface.open);
  drawer.querySelector("[data-close-arcs]")!.addEventListener("click", surface.close);
  body.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.dataset.arcSelect) { picked = button.dataset.arcSelect; question = undefined; if (state) draw(state, false); }
    if (button.dataset.arcScope) { scope = button.dataset.arcScope as BoardScope; picked = undefined; question = undefined; watching?.setScope(scope); remember(); }
    if (button.dataset.arcQueue) {
      const id = button.dataset.arcQueue;
      if (queues.has(id)) queues.delete(id); else queues.add(id);
      if (state) draw(state);
    }
    if (button.dataset.questionOpen) {
      question = button.dataset.questionOpen;
      if (state) draw(state, false);
      body.querySelector<HTMLButtonElement>("[data-question-back]")?.focus({ preventScroll: true });
    }
    if (button.hasAttribute("data-question-back")) {
      const previous = question; question = undefined;
      if (state) draw(state, false);
      [...body.querySelectorAll<HTMLButtonElement>("[data-question-open]")].find((node) => node.dataset.questionOpen === previous)?.focus({ preventScroll: true });
    }
  });
  body.addEventListener("toggle", (event) => {
    const detail = event.target as HTMLDetailsElement;
    if (!detail.isConnected || !detail.dataset.foldKey) return;
    if (detail.open) folds.add(detail.dataset.foldKey); else folds.delete(detail.dataset.foldKey);
  }, true);
  if (saved.open) surface.open();
  return surface;
}
