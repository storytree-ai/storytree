/**
 * The capability tree's own space (the forest story, capability 4; ADR-0743): a large layer over
 * the forest, beside the story panel, where the tree is drawn at a readable size and moved rather
 * than shrunk. Drag pans it; the wheel, a trackpad pinch or a two-finger pinch zooms it about the
 * pointer. There are no scroll bars (0.2's ADR-0502), and the pan is bounded so the tree can never
 * be dragged out of reach. It opens centred on the story's own capabilities, and keeps where it was
 * while the live reading redraws the same story. Clicking a card chooses it as the panel's does.
 */
import type { StoryPanel } from "@storytree/forest";

import { renderTree } from "./story-panel.js";

export interface TreeSpace {
  /** Open the space on `panel`, or redraw it, with `selected` marked. */
  show(panel: StoryPanel, selected: string | undefined): void;
  close(): void;
  readonly open: boolean;
  stop(): void;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
/** How much of the tree stays inside the frame, however far it is dragged. */
const KEEP = 96;
/** A pointer that moves further than this between down and up dragged; it did not click. */
const DRAG = 4;

export function mountTreeSpace(host: HTMLElement, on: { choose(id: string): void; closed(): void }): TreeSpace {
  const space = document.createElement("section");
  space.className = "tree-space";
  space.hidden = true;
  space.setAttribute("aria-label", "Capability tree");
  space.innerHTML = `
    <header class="tree-space-head">
      <h2></h2>
      <span class="tree-space-legend">
        <span class="legend-planned">planned</span><span class="legend-in-progress">in progress</span><span class="legend-landed">landed</span>
      </span>
      <button type="button" class="tree-space-fit">Centre</button>
      <button type="button" class="tree-space-close" aria-label="Close the capability tree">×</button>
    </header>
    <div class="tree-space-frame">
      <div class="tree-space-surface"></div>
      <p class="tree-space-hint">Drag to move · scroll or pinch to zoom</p>
    </div>`;
  host.append(space);
  const heading = space.querySelector("h2") as HTMLHeadingElement;
  const frame = space.querySelector(".tree-space-frame") as HTMLDivElement;
  const surface = space.querySelector(".tree-space-surface") as HTMLDivElement;

  let story: string | undefined;
  let view: View = { x: 0, y: 0, scale: 1 };

  const size = (): { width: number; height: number } => {
    const svg = surface.querySelector("svg");
    return { width: Number(svg?.getAttribute("width") ?? 0), height: Number(svg?.getAttribute("height") ?? 0) };
  };
  const write = (): void => {
    view = bounded(view, size(), { width: frame.clientWidth, height: frame.clientHeight });
    surface.style.transform = `translate(${view.x.toFixed(1)}px, ${view.y.toFixed(1)}px) scale(${view.scale.toFixed(3)})`;
    surface.dataset.view = JSON.stringify({ x: Math.round(view.x), y: Math.round(view.y), scale: Number(view.scale.toFixed(3)) });
  };
  /** Centre on the story's own cards (the middle of them), at full size. */
  const centre = (): void => {
    const own = [...surface.querySelectorAll<SVGGElement>("[data-capability-id]")].map((card) => {
      const at = card.transform.baseVal.consolidate()?.matrix;
      const box = card.querySelector<SVGRectElement>(".card-bg");
      return { x: (at?.e ?? 0) + (box?.width.baseVal.value ?? 0) / 2, y: (at?.f ?? 0) + (box?.height.baseVal.value ?? 0) / 2 };
    });
    const middle = own.length === 0
      ? { x: size().width / 2, y: size().height / 2 }
      : { x: own.reduce((sum, { x }) => sum + x, 0) / own.length, y: own.reduce((sum, { y }) => sum + y, 0) / own.length };
    view = { scale: 1, x: frame.clientWidth / 2 - middle.x, y: frame.clientHeight / 2 - middle.y };
    write();
  };

  // Drag to pan; two fingers pinch. A card pressed and released without a drag is a click.
  const pointers = new Map<number, { x: number; y: number }>();
  let travelled = 0;
  let pinch: { distance: number } | undefined;
  frame.addEventListener("pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) travelled = 0;
    frame.setPointerCapture(event.pointerId);
    frame.classList.add("is-grabbing");
  });
  frame.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (last === undefined) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch !== undefined && pinch.distance > 0) zoom(distance / pinch.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = { distance };
      travelled = Infinity;
      return;
    }
    travelled += Math.hypot(now.x - last.x, now.y - last.y);
    view = { ...view, x: view.x + now.x - last.x, y: view.y + now.y - last.y };
    write();
  });
  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = undefined;
    if (pointers.size === 0) frame.classList.remove("is-grabbing");
  };
  frame.addEventListener("pointerup", release);
  frame.addEventListener("pointercancel", release);
  frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    // A trackpad pinch arrives as a wheel with ctrl held, in finer steps.
    zoom(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX, event.clientY);
  }, { passive: false });
  const zoom = (by: number, clientX: number, clientY: number): void => {
    const box = frame.getBoundingClientRect();
    view = zoomedAbout(view, by, clientX - box.left, clientY - box.top);
    write();
  };

  // The pointer is captured by the frame, so a click lands on the frame: find the card under it.
  frame.addEventListener("click", (event) => {
    if (travelled > DRAG) return;
    const card = document.elementsFromPoint(event.clientX, event.clientY).map((node) => node.closest<SVGGElement>(".tree-space-surface [data-capability-id]")).find((node) => node !== null);
    if (card?.dataset.capabilityId !== undefined) on.choose(card.dataset.capabilityId);
  });
  surface.addEventListener("keydown", (event) => {
    const card = (event.target as Element).closest<SVGGElement>("[data-capability-id]");
    if (card === null || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (card.dataset.capabilityId !== undefined) on.choose(card.dataset.capabilityId);
  });
  const close = (): void => {
    if (space.hidden) return;
    space.hidden = true;
    story = undefined;
    on.closed();
  };
  space.querySelector(".tree-space-close")?.addEventListener("click", close);
  space.querySelector(".tree-space-fit")?.addEventListener("click", centre);
  // Escape closes the space before it reaches the forest, which would close the panel too.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || space.hidden) return;
    event.stopPropagation();
    close();
  };
  window.addEventListener("keydown", onKey, { capture: true });
  const resized = new ResizeObserver(() => { if (!space.hidden) write(); });
  resized.observe(frame);

  return {
    show(panel, selected) {
      const focused = document.activeElement?.matches("[data-capability-id]") === true && space.contains(document.activeElement);
      heading.textContent = `${panel.title}: capability tree`;
      surface.innerHTML = renderTree(panel, selected, "tree-space-diagram");
      const opening = space.hidden || story !== panel.story;
      space.hidden = false;
      story = panel.story;
      if (opening) centre();
      else write();
      if (focused) surface.querySelector<SVGGElement>(".selected")?.focus({ preventScroll: true });
    },
    close,
    get open() {
      return !space.hidden;
    },
    stop() {
      window.removeEventListener("keydown", onKey, { capture: true });
      resized.disconnect();
      space.remove();
    },
  };
}

/** `view` zoomed by `by` about a point of the frame, keeping the point under it where it was. */
function zoomedAbout(view: View, by: number, x: number, y: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * by));
  const k = scale / view.scale;
  return { scale, x: x - (x - view.x) * k, y: y - (y - view.y) * k };
}

/** `view` bounded so at least KEEP pixels of the tree (or all of it, if smaller) stay in the frame. */
function bounded(view: View, tree: { width: number; height: number }, frame: { width: number; height: number }): View {
  const axis = (at: number, content: number, room: number): number => {
    const keep = Math.min(KEEP, content);
    return Math.min(room - keep, Math.max(keep - content, at));
  };
  return { scale: view.scale, x: axis(view.x, tree.width * view.scale, frame.width), y: axis(view.y, tree.height * view.scale, frame.height) };
}
