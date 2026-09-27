import type { BoardReads } from "../board/reads.js";
import { watchBoard, type BoardState } from "../board/live-board.js";
import type { BoardScope } from "../board/board.js";
import type { ArcDrawn } from "../board/smoke.js";
import type { Timers } from "../live-reading/live-reading.js";
import { escape, renderBoard } from "./render.js";

export interface ArcSurface { open(): void; close(): void; stop(): void }
/** Mount one read-only overlay over the current surface; closing leaves that surface mounted. */
export function mountArcSurface(host: HTMLElement, options: { project: string; reads: BoardReads; timers?: Timers }): ArcSurface {
  const root = document.createElement("div");
  root.className = "arc-surface-mount";
  root.innerHTML = `<button type="button" class="arc-launch" data-open-arcs>Arcs</button><dialog class="arc-overlay" aria-label="Arc surface"><header class="arc-header"><div><h2>Arcs</h2><p>${escape(options.project)} · Work in flight</p></div><button type="button" data-close-arcs aria-label="Close arc surface">Close</button></header><div class="arc-status" role="status"></div><div class="arc-body"></div></dialog>`;
  host.append(root);
  const launch = root.querySelector<HTMLButtonElement>("[data-open-arcs]")!;
  const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
  const body = root.querySelector<HTMLElement>(".arc-body")!;
  const status = root.querySelector<HTMLElement>(".arc-status")!;
  let watching: ReturnType<typeof watchBoard> | undefined;
  let state: BoardState | undefined;
  let picked: string | undefined;
  const folds = new Set<string>();
  function draw(next: BoardState, preservePosition = true): void {
    const sameScope = state?.board?.scope === next.board?.scope;
    state = next;
    dialog.dataset.arcState = next.status;
    status.textContent = next.status === "loading" ? "Reading arcs…" : next.status === "error" ? `Arcs could not be read: ${next.error}. Retrying…` : "";
    status.setAttribute("role", next.status === "error" ? "alert" : "status");
    // Read failure leaves the last good board on show, explicitly stale. Never turn it into empty work.
    if (!next.board) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusKey = focused?.dataset.arcSelect ?? focused?.dataset.arcScope;
    const focusedFold = focused?.tagName === "SUMMARY" ? focused.parentElement?.dataset.foldKey : undefined;
    const positions = [".arc-lanes", ".arc-briefing"].map((selector) => ({ selector, top: preservePosition && sameScope ? body.querySelector(selector)?.scrollTop ?? 0 : 0 }));
    body.innerHTML = renderBoard(next.board, picked);
    for (const detail of body.querySelectorAll<HTMLDetailsElement>("details[data-fold-key]")) detail.open = folds.has(detail.dataset.foldKey!);
    if (focusKey) [...body.querySelectorAll<HTMLElement>("button")].find((button) => (button.dataset.arcSelect ?? button.dataset.arcScope) === focusKey)?.focus();
    if (focusedFold) [...body.querySelectorAll<HTMLElement>("details[data-fold-key]")].find((detail) => detail.dataset.foldKey === focusedFold)?.querySelector<HTMLElement>("summary")?.focus();
    for (const { selector, top } of positions) { const pane = body.querySelector(selector); if (pane) pane.scrollTop = top; }
    const drawn: ArcDrawn = {
      arcs: [...new Set([...body.querySelectorAll<HTMLElement>("[data-arc-id]")].map((node) => node.dataset.arcId!))],
      increments: [...new Set([...body.querySelectorAll<HTMLElement>("[data-increment-id]")].map((node) => node.dataset.incrementId!))],
      holders: [...body.querySelectorAll<HTMLElement>("[data-agent-session]")].map((node) => ({ work: node.dataset.workId!, session: node.dataset.agentSession!, label: node.dataset.agentLabel! })),
    };
    dialog.dataset.drew = JSON.stringify(drawn);
  }
  const surface: ArcSurface = {
    open() {
      if (dialog.open) return;
      picked = undefined; folds.clear(); body.replaceChildren(); delete dialog.dataset.drew;
      dialog.showModal();
      watching = watchBoard({ ...options, onState: draw });
    },
    close() { watching?.stop(); watching = undefined; dialog.close(); launch.focus(); },
    stop() { watching?.stop(); watching = undefined; dialog.close(); root.remove(); },
  };
  launch.addEventListener("click", surface.open);
  dialog.querySelector("[data-close-arcs]")!.addEventListener("click", surface.close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); surface.close(); });
  body.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.dataset.arcSelect) { event.preventDefault(); picked = button.dataset.arcSelect; if (state) draw(state, false); }
    if (button.dataset.arcScope) { picked = undefined; watching?.setScope(button.dataset.arcScope as BoardScope); }
  });
  body.addEventListener("toggle", (event) => {
    const detail = event.target as HTMLDetailsElement;
    if (!detail.isConnected || !detail.dataset.foldKey) return;
    if (detail.open) folds.add(detail.dataset.foldKey); else folds.delete(detail.dataset.foldKey);
  }, true);
  return surface;
}
