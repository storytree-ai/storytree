/**
 * Capability 4 · Drill-down. The panel's folds as the user works them (ADR-1284 D1): a double-click on a handle opens its
 * fold in place and another closes it, while a single click only focuses it; Enter or Space opens or closes it from the
 * keyboard, the arrow keys move between the handles shown, and Escape closes the fold the focus is in or, with none
 * focused, closes every fold and forgets the kept depth. The kinds of fold the user opened open again on every later
 * pick for the session; a contract's own fold and Open all · n are never kept across picks (the app's panel holds a contract's own fold only while library news redraws the same story, ADR-0836 D1). No hint explains any of it (ADR-1283 D2).
 */

/** The kinds of fold whose being open is kept across picks: the top-level handles, never a contract's own. */
const KEPT = new Set(["more", "health", "open-work", "contracts", "extra-checks"]);

export interface PanelFolds {
  /** After the panel's HTML is drawn into `panel`: open the kinds the user keeps open, and answer his handles (once per element). */
  draw(panel: HTMLElement): void;
}

/** One session's folds: the kinds the user opened are held here until he closes them, presses Escape, or the app restarts. */
export function panelFolds(): PanelFolds {
  const kept = new Set<string>();
  const wired = new WeakSet<HTMLElement>();

  const handles = (panel: HTMLElement): HTMLButtonElement[] => [...panel.querySelectorAll<HTMLButtonElement>(".panel-handle")];
  const shown = (panel: HTMLElement): HTMLButtonElement[] => handles(panel).filter((handle) => handle.closest(".panel-fold-body[hidden]") === null);
  const set = (handle: HTMLElement, open: boolean): void => {
    const body = handle.nextElementSibling as HTMLElement | null;
    if (body === null || !body.classList.contains("panel-fold-body")) return;
    handle.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
  };
  const kind = (handle: HTMLElement): string | undefined => handle.parentElement?.dataset.fold;

  /** The user opens or closes one fold, or opens every one with Open all. */
  const toggle = (panel: HTMLElement, handle: HTMLElement): void => {
    if (handle.dataset.openAll !== undefined) {
      for (const each of handles(panel)) set(each, true);
      return;
    }
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
    panel.addEventListener("dblclick", (event) => {
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
        // Kept from the button's own click, which a pointer's single click shares and which never expands.
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
      for (const handle of handles(panel)) {
        const which = kind(handle);
        if (which !== undefined && kept.has(which)) set(handle, true);
      }
    },
  };
}
