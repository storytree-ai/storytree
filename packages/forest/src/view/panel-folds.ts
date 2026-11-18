// Capability 4 · Drill-down

import { panelScope } from "./microscope.js";

const KEPT = new Set(["open-work", "contracts", "extra-checks"]);

export interface PanelFolds {
  draw(panel: HTMLElement): void;
}

export function panelFolds(): PanelFolds {
  const kept = new Set<string>();
  const wired = new WeakSet<HTMLElement>();
  const scope = panelScope();

  const handles = (panel: HTMLElement): HTMLButtonElement[] => [...panel.querySelectorAll<HTMLButtonElement>(".panel-handle")];
  const shown = (panel: HTMLElement): HTMLButtonElement[] => handles(panel).filter((handle) => handle.closest(".panel-fold-body[hidden]") === null);
  const set = (handle: HTMLElement, open: boolean): void => {
    const body = handle.nextElementSibling as HTMLElement | null;
    if (body === null || !body.classList.contains("panel-fold-body")) return;
    handle.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  };
  const kind = (handle: HTMLElement): string | undefined => handle.parentElement?.dataset.fold;

  const toggle = (panel: HTMLElement, handle: HTMLElement): void => {
    const open = handle.getAttribute("aria-expanded") !== "true";
    set(handle, open);
    const which = kind(handle);
    if (which === undefined || !KEPT.has(which)) return;
    if (open) kept.add(which);
    else kept.delete(which);
  };

  const escape = (panel: HTMLElement, from: Element): void => {
    const handle = from.closest<HTMLElement>(".panel-handle");
    if (handle?.getAttribute("aria-expanded") === "true") return toggle(panel, handle);
    const body = from.closest<HTMLElement>(".panel-fold-body:not([hidden])");
    const owner = body?.previousElementSibling as HTMLElement | null | undefined;
    if (owner?.classList.contains("panel-handle") === true && panel.contains(owner)) {
      toggle(panel, owner);
      owner.focus();
      return;
    }
    kept.clear();
    for (const each of handles(panel)) set(each, false);
  };

  const wire = (panel: HTMLElement): void => {
    wired.add(panel);
    panel.addEventListener("click", (event) => {
      const handle = (event.target as Element | null)?.closest<HTMLElement>(".panel-handle");
      if (handle === null || handle === undefined || !panel.contains(handle)) return;
      event.stopPropagation();
      toggle(panel, handle);
    });
    panel.addEventListener("keydown", (event) => {
      const from = event.target as Element | null;
      if (from === null) return;
      const handle = from.closest<HTMLElement>(".panel-handle");
      if (event.key === "Escape") {
        event.preventDefault();
        escape(panel, from);
        return;
      }
      if (handle === null) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle(panel, handle);
        return;
      }
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const list = shown(panel);
      const at = list.indexOf(handle as HTMLButtonElement);
      list[Math.min(Math.max(at + step, 0), list.length - 1)]?.focus();
    });
  };

  return {
    draw(panel) {
      if (!wired.has(panel)) wire(panel);
      scope.draw(panel);
      for (const handle of handles(panel)) {
        const which = kind(handle);
        if (which !== undefined && kept.has(which)) set(handle, true);
      }
    },
  };
}
