/**
 * Capability 2 · Storytree projects. The page's left rail (ADR-1219): one full-height column down the window's left, under the
 * app bar, with a tab for each of the sessions list and the arcs that is switched on, Sessions then Arcs. One tab shows at a
 * time; the one chosen is kept per project in the page's storage, and a project with none kept opens on Arcs, where the owner
 * plans. The Arcs tab carries a badge of what waits on him there, which the arc surface tells it. The rail is the frame's: each
 * story mounts its own surface in its tab's panel.
 *
 * Its right edge is a handle (a separator) that sets its width by dragging or by the arrow keys, between a width its contents stay
 * readable at and one that leaves the map usable; dragged past half that least width it collapses away, and the map takes the
 * window. A toggle in the app bar, and Ctrl+B, hide and show it, at the width last dragged to. Width and collapse are kept for the
 * window, not per project, in the page's storage. The map beside it reads its own size, so it redraws to the space it is given.
 */

export type RailTab = "sessions" | "arcs";

const NAMES: Readonly<Record<RailTab, string>> = { sessions: "Sessions", arcs: "Arcs" };
const key = (project: string) => `storytree.app.rail-tab.v1:${project}`;
const SIZE_KEY = "storytree.app.rail.v1";
/** The least width the rail's rows stay readable at; dragged left of half of it, the rail collapses away. */
export const RAIL_MIN = 220;
const RAIL_MOST = 720;
/** The map keeps at least this much of the window beside the rail. */
const MAP_LEAST = 360;
const STEP = 16;

/** The width the rail may take in a window `windowWidth` wide: never under its least, never so wide the map is unusable. */
export function railBounds(windowWidth: number): { min: number; max: number; initial: number } {
  const max = Math.max(RAIL_MIN, Math.min(RAIL_MOST, windowWidth - MAP_LEAST));
  return { min: RAIL_MIN, max, initial: Math.min(max, Math.max(RAIL_MIN, Math.round(Math.min(384, windowWidth * 0.4)))) };
}

/** What a drag released at `x` (the pointer's distance from the rail's left) leaves: collapsed past half the least width, else the width clamped. */
export function railDragged(x: number, bounds: { min: number; max: number }): { collapsed: true } | { collapsed: false; width: number } {
  if (x < bounds.min / 2) return { collapsed: true };
  return { collapsed: false, width: Math.round(Math.min(bounds.max, Math.max(bounds.min, x))) };
}

const TOGGLE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/></svg>`;

export interface Rail {
  /** The panel a tab's surface mounts in. */
  panel(tab: RailTab): HTMLElement;
  /** What waits on the owner in the arcs; none hides the badge. */
  badge(count: number): void;
  stop(): void;
}

/** Mounts the rail at the start of `content` with `tabs` in the rail's order; with none it mounts nothing. */
export function mountRail(content: HTMLElement, options: { project: string; tabs: readonly RailTab[]; storage?: Pick<Storage, "getItem" | "setItem">; toggleHost?: HTMLElement }): Rail | undefined {
  const tabs = (["sessions", "arcs"] as const).filter((tab) => options.tabs.includes(tab));
  if (tabs.length === 0) return undefined;
  const document = content.ownerDocument;
  const storage = options.storage ?? document.defaultView?.localStorage;
  const kept = (() => { try { return storage?.getItem(key(options.project)); } catch { return null; } })();
  let shown: RailTab = tabs.find((tab) => tab === kept) ?? (tabs.includes("arcs") ? "arcs" : tabs[0]!);
  const rail = document.createElement("aside");
  rail.className = "side-rail";
  rail.id = "side-rail";
  rail.setAttribute("aria-label", "Sessions and arcs");
  rail.innerHTML = `<div class="side-rail-tabs" role="tablist" aria-label="Rail">${tabs.map((tab) =>
    `<button type="button" role="tab" id="rail-tab-${tab}" data-rail-tab="${tab}" aria-controls="rail-${tab}">${NAMES[tab]}${tab === "arcs" ? `<span class="side-rail-badge" data-rail-badge hidden></span>` : ""}</button>`).join("")}</div>`
    + tabs.map((tab) => `<div role="tabpanel" class="side-rail-panel" id="rail-${tab}" aria-labelledby="rail-tab-${tab}"></div>`).join("");
  content.prepend(rail);
  const buttons = [...rail.querySelectorAll<HTMLButtonElement>("[data-rail-tab]")];
  const show = (tab: RailTab): void => {
    shown = tab;
    // The rail is the surface of the tab on show, so the feedback corner names it from the tabs too. It is marked as no layer,
    // ranking with the map beside it, so a control on neither (the gear) names the map, as before the rail.
    rail.dataset.surfaceId = tab;
    for (const button of buttons) {
      const on = button.dataset.railTab === tab;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    for (const panel of rail.querySelectorAll<HTMLElement>("[role=tabpanel]")) panel.hidden = panel.id !== `rail-${tab}`;
  };
  show(shown);
  const choose = (tab: RailTab): void => {
    show(tab);
    try { storage?.setItem(key(options.project), tab); } catch { /* Keep this launch's choice. */ }
  };
  for (const button of buttons) button.addEventListener("click", () => choose(button.dataset.railTab as RailTab));
  // The tabs' arrow keys, as a tab list's: the next or previous tab is chosen and takes the focus.
  rail.querySelector(".side-rail-tabs")!.addEventListener("keydown", (event) => {
    const { key: pressed } = event as KeyboardEvent;
    if (pressed !== "ArrowLeft" && pressed !== "ArrowRight") return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(shown) + (pressed === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    choose(next);
    buttons.find((button) => button.dataset.railTab === next)?.focus();
  });
  const badge = rail.querySelector<HTMLElement>("[data-rail-badge]");

  // Its width and whether it is collapsed, kept for the window.
  const window = document.defaultView!;
  const bounds = () => railBounds(window.innerWidth);
  const size = (() => {
    try {
      const read = JSON.parse(storage?.getItem(SIZE_KEY) ?? "null") as { width?: unknown; collapsed?: unknown } | null;
      return { width: typeof read?.width === "number" && Number.isFinite(read.width) ? read.width : undefined, collapsed: read?.collapsed === true };
    } catch { return { width: undefined, collapsed: false }; }
  })();
  let width = size.width ?? bounds().initial;
  let collapsed = size.collapsed;
  const keep = (): void => {
    try { storage?.setItem(SIZE_KEY, JSON.stringify({ width, collapsed })); } catch { /* Keep this launch's size. */ }
  };
  const handle = document.createElement("div");
  handle.className = "side-rail-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-controls", rail.id);
  handle.setAttribute("aria-label", "Resize the sidebar");
  handle.tabIndex = 0;
  rail.after(handle);
  const toggle = options.toggleHost === undefined ? undefined : document.createElement("button");
  if (toggle) {
    toggle.type = "button";
    toggle.className = "side-rail-toggle";
    toggle.setAttribute("aria-controls", rail.id);
    toggle.innerHTML = TOGGLE_ICON;
    options.toggleHost!.prepend(toggle);
  }
  /** Lays the rail out at `shownWidth`, or collapsed; the map beside it follows the width its frame gives it. */
  const lay = (shownWidth: number, hide: boolean): void => {
    const { min, max } = bounds();
    const at = Math.round(Math.min(max, Math.max(min, shownWidth)));
    rail.hidden = hide;
    content.style.setProperty("--rail-width", hide ? "0px" : `${at}px`);
    content.toggleAttribute("data-rail-collapsed", hide);
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", hide ? "0" : String(at));
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(!hide));
      toggle.setAttribute("aria-label", hide ? "Show sidebar" : "Hide sidebar");
      toggle.title = hide ? "Show sidebar (Ctrl+B)" : "Hide sidebar (Ctrl+B)";
    }
  };
  const settle = (): void => { lay(width, collapsed); };
  settle();
  const setCollapsed = (hide: boolean): void => { collapsed = hide; settle(); keep(); };
  toggle?.addEventListener("click", () => setCollapsed(!collapsed));

  // Dragging the handle: the rail follows the pointer, collapsing while it is left of half the least width.
  let dragging: { pointer: number; from: number } | undefined;
  const left = (): number => content.getBoundingClientRect().left;
  const onMove = (event: Event): void => {
    const { clientX, pointerId } = event as PointerEvent;
    if (dragging === undefined || pointerId !== dragging.pointer) return;
    const next = railDragged(clientX - left(), bounds());
    if (next.collapsed) lay(width, true);
    else { width = next.width; lay(width, false); }
  };
  const onUp = (event: Event): void => {
    const { clientX, pointerId } = event as PointerEvent;
    if (dragging === undefined || pointerId !== dragging.pointer) return;
    const { from } = dragging;
    dragging = undefined;
    content.removeAttribute("data-rail-dragging");
    const next = railDragged(clientX - left(), bounds());
    // Collapsed by a drag, it shows again at the width it had before that drag, not one it passed on the way.
    if (next.collapsed) { collapsed = true; width = from; }
    else { width = next.width; collapsed = false; }
    settle();
    keep();
  };
  handle.addEventListener("pointerdown", (event) => {
    const { button, pointerId } = event as PointerEvent;
    if (button !== 0) return;
    event.preventDefault();
    dragging = { pointer: pointerId, from: width };
    content.setAttribute("data-rail-dragging", "");
  });
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
  handle.addEventListener("keydown", (event) => {
    const { key: pressed } = event as KeyboardEvent;
    if (pressed === "Enter") { event.preventDefault(); setCollapsed(!collapsed); return; }
    if (pressed !== "ArrowLeft" && pressed !== "ArrowRight") return;
    event.preventDefault();
    // Collapsed, the right arrow shows it again at its width, and the left leaves it collapsed.
    if (collapsed) { if (pressed === "ArrowRight") setCollapsed(false); return; }
    const { min, max } = bounds();
    width = Math.min(max, Math.max(min, width + (pressed === "ArrowRight" ? STEP : -STEP)));
    settle();
    keep();
  });
  // Ctrl+B (Cmd+B on a Mac), as in the coding tools he knows, unless the keys are typing into a field.
  const onShortcut = (event: Event): void => {
    const pressed = event as KeyboardEvent;
    if (!(pressed.ctrlKey || pressed.metaKey) || pressed.altKey || pressed.shiftKey || pressed.key.toLowerCase() !== "b") return;
    const target = pressed.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
    event.preventDefault();
    setCollapsed(!collapsed);
  };
  document.addEventListener("keydown", onShortcut);
  window.addEventListener("resize", settle);

  return {
    panel: (tab) => rail.querySelector<HTMLElement>(`#rail-${tab}`)!,
    badge(count) {
      if (!badge) return;
      badge.hidden = count === 0;
      badge.textContent = String(count);
      badge.title = `${count} waiting on you`;
      buttons.find((button) => button.dataset.railTab === "arcs")?.setAttribute("aria-label", count === 0 ? "Arcs" : `Arcs, ${count} waiting on you`);
    },
    stop() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("keydown", onShortcut);
      window.removeEventListener("resize", settle);
      rail.remove();
      handle.remove();
      toggle?.remove();
      content.style.removeProperty("--rail-width");
      content.removeAttribute("data-rail-collapsed");
      content.removeAttribute("data-rail-dragging");
    },
  };
}
