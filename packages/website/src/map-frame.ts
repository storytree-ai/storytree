/**
 * Capability 2 · The forest on the site. The frame round the map at the top of the page (ADR-1091 D2): the map never takes
 * the page's scroll or its keys. A plain wheel scrolls the page; ctrl+wheel, a pinch and the frame's own buttons zoom; a drag
 * pans. On touch the map is still until tapped, with a way back out, so a thumb scrolling the page is never caught by it.
 */

declare global {
  /** The window events between chapter 1 (opening.ts), the page (main.ts) and the map's loader (forest.ts). */
  interface WindowEventMap {
    "storytree-opening": CustomEvent<{ active: boolean }>;
    "storytree-arrived": Event;
  }
}

/** The keys the map's sheet would move on (forest's `sheetKey`: WASD and the arrows pan, Q and E spin, R and F tilt, Home
 * goes home). On this page they stay the page's: the frame stops them before the map hears them, and the page scrolls. */
const mapKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "q", "e", "r", "f", "home"]);
const typing = (target: EventTarget | null) => {
  const node = target as { tagName?: string; isContentEditable?: boolean } | null;
  return node?.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(node?.tagName ?? "");
};
/** How many wheel notches one press of + or − is worth. */
const notches = 3;

/** Wires the frame: `frame` holds the map's canvas, its zoom buttons and, on touch, its tap and exit buttons. */
export function wireMapFrame(frame: HTMLElement, view: Window & typeof globalThis = window): () => void {
  const tap = frame.querySelector<HTMLButtonElement>("[data-map-tap]"), exit = frame.querySelector<HTMLButtonElement>("[data-map-exit]");
  const touch = view.matchMedia("(pointer: coarse)").matches;
  // "page": the map is still and the page scrolls through it; "map": the visitor's hand is on the map.
  const hand = (on: "page" | "map", focus = false) => {
    frame.dataset.hand = on;
    if (tap) tap.hidden = !touch || on === "map";
    if (exit) exit.hidden = !touch || on === "page";
    if (focus) (on === "map" ? exit : tap)?.focus({ preventScroll: true });
  };
  hand(touch ? "page" : "map");
  // A plain wheel never reaches the map, so the browser scrolls the page; ctrl+wheel (and a trackpad's pinch, which arrives as
  // one) goes through and zooms. Nothing here cancels the wheel, so a panel's own list inside the frame still scrolls.
  const onWheel = (event: WheelEvent) => { if (!event.ctrlKey) event.stopPropagation(); };
  // The map listens on the window, so the window's capture phase stops its keys first; their default (scrolling) is kept.
  const onKey = (event: KeyboardEvent) => {
    if (touch && frame.dataset.hand === "map" && event.key === "Escape") { hand("page", true); return; }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !typing(event.target) && mapKeys.has(event.key.toLowerCase())) event.stopPropagation();
  };
  // + and − zoom as ctrl+wheel does, at the middle of the map.
  const onZoom = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest?.<HTMLElement>("[data-zoom]");
    const canvas = frame.querySelector("canvas");
    if (!button || !canvas) return;
    const box = canvas.getBoundingClientRect(), deltaY = button.dataset.zoom === "in" ? -100 : 100;
    for (let i = 0; i < notches; i++) canvas.dispatchEvent(new view.WheelEvent("wheel", { deltaY, ctrlKey: true, bubbles: true, cancelable: true,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
  };
  // While the map is still, a finger on it is the page's: the frame keeps it from the map (its tap layer covers the map too).
  const onPointer = (event: Event) => {
    if (frame.dataset.hand === "page" && !(event.target as Element | null)?.closest?.("[data-map-tap]")) event.stopPropagation();
  };
  const onTap = () => hand("map", true), onExit = () => hand("page", true);
  const pointers = ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove"] as const;
  for (const type of pointers) frame.addEventListener(type, onPointer, { capture: true, passive: true });
  frame.addEventListener("wheel", onWheel, { capture: true, passive: true });
  view.addEventListener("keydown", onKey, { capture: true });
  frame.addEventListener("click", onZoom);
  tap?.addEventListener("click", onTap);
  exit?.addEventListener("click", onExit);
  return () => {
    for (const type of pointers) frame.removeEventListener(type, onPointer, { capture: true });
    frame.removeEventListener("wheel", onWheel, { capture: true });
    view.removeEventListener("keydown", onKey, { capture: true });
    frame.removeEventListener("click", onZoom);
    tap?.removeEventListener("click", onTap);
    exit?.removeEventListener("click", onExit);
  };
}
