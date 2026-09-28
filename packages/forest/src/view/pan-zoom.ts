/**
 * Moving the capability tree about in a frame (the forest story, capability 4; ADR-0743), shared by
 * the tree's two spaces: the one inside the story panel and the larger window it pops out into.
 * Drag pans; the wheel, a trackpad pinch or a two-finger pinch zooms about the pointer. There are no
 * scroll bars (0.2's ADR-0502), and the pan is bounded so the tree can never be dragged out of
 * reach. A card pressed and released without a drag is a click, and chooses it.
 */

export interface View {
  x: number;
  y: number;
  scale: number;
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export interface PanZoom {
  /** Where the tree is now; hand it back to `place` to keep it across a redraw. */
  readonly view: View;
  place(view: View): void;
  /** Put the middle of the card `selected` (or of all the story's cards) in the middle of the frame, at full size. */
  centre(selected?: string): void;
  stop(): void;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
/** How much of the tree stays inside the frame, however far it is dragged. */
const KEEP = 96;
/** A pointer that moves further than this between down and up dragged; it did not click. */
const DRAG = 4;

/**
 * Let `frame` move `surface`, which holds the tree's SVG at 1 unit to 1 pixel and may be redrawn;
 * `choose` hears a card clicked or keyed. Place it with `centre` or `place` once the tree is drawn.
 */
export function attachPanZoom(frame: HTMLElement, surface: HTMLElement, choose: (id: string) => void): PanZoom {
  let view: View = { x: 0, y: 0, scale: 1 };

  const size = (): Size => {
    const svg = surface.querySelector("svg");
    return { width: Number(svg?.getAttribute("width") ?? 0), height: Number(svg?.getAttribute("height") ?? 0) };
  };
  const write = (): void => {
    view = bounded(view, size(), { width: frame.clientWidth, height: frame.clientHeight });
    surface.style.transform = `translate(${view.x.toFixed(1)}px, ${view.y.toFixed(1)}px) scale(${view.scale.toFixed(3)})`;
    surface.dataset.view = JSON.stringify({ x: Math.round(view.x), y: Math.round(view.y), scale: Number(view.scale.toFixed(3)) });
  };
  const centre = (selected?: string): void => {
    const cards = [...surface.querySelectorAll<SVGGElement>("[data-capability-id]")].map((card) => {
      const at = card.transform.baseVal.consolidate()?.matrix;
      const box = card.querySelector<SVGRectElement>(".card-bg");
      return { id: card.dataset.capabilityId ?? "", x: at?.e ?? 0, y: at?.f ?? 0, width: box?.width.baseVal.value ?? 0, height: box?.height.baseVal.value ?? 0 };
    });
    const point = cards.length === 0 ? { x: size().width / 2, y: size().height / 2 } : focusOf(cards, selected);
    view = centredOn(point, { width: frame.clientWidth, height: frame.clientHeight });
    write();
  };

  const pointers = new Map<number, Point>();
  let travelled = 0;
  let pinch: { distance: number } | undefined;
  const zoom = (by: number, clientX: number, clientY: number): void => {
    const box = frame.getBoundingClientRect();
    view = zoomedAbout(view, by, clientX - box.left, clientY - box.top);
    write();
  };
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

  // The pointer is captured by the frame, so a click lands on the frame: find the card under it.
  frame.addEventListener("click", (event) => {
    if (travelled > DRAG) return;
    const card = document.elementsFromPoint(event.clientX, event.clientY).map((node) => (surface.contains(node) ? node.closest<SVGGElement>("[data-capability-id]") : null)).find((node) => node !== null);
    if (card?.dataset.capabilityId !== undefined) choose(card.dataset.capabilityId);
  });
  surface.addEventListener("keydown", (event) => {
    const card = (event.target as Element).closest<SVGGElement>("[data-capability-id]");
    if (card === null || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (card.dataset.capabilityId !== undefined) choose(card.dataset.capabilityId);
  });
  // A hidden frame has no size to bound the tree in.
  const resized = new ResizeObserver(() => { if (frame.clientWidth > 0) write(); });
  resized.observe(frame);

  return {
    get view() {
      return view;
    },
    place(kept) {
      view = kept;
      write();
    },
    centre,
    stop() {
      resized.disconnect();
    },
  };
}

/** The point to open on: the middle of the card `selected`, or else the middle of all the cards. */
export function focusOf(cards: readonly ({ id: string } & Point & Size)[], selected: string | undefined): Point {
  const middle = (card: Point & Size): Point => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 });
  const chosen = cards.find(({ id }) => id === selected);
  if (chosen !== undefined) return middle(chosen);
  const all = cards.map(middle);
  return { x: all.reduce((sum, { x }) => sum + x, 0) / all.length, y: all.reduce((sum, { y }) => sum + y, 0) / all.length };
}

/** The view, at full size, that puts `point` of the tree in the middle of `frame`. */
export function centredOn(point: Point, frame: Size): View {
  return { x: frame.width / 2 - point.x, y: frame.height / 2 - point.y, scale: 1 };
}

/** `view` zoomed by `by` about a point of the frame, keeping the point under it where it was. */
export function zoomedAbout(view: View, by: number, x: number, y: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * by));
  const k = scale / view.scale;
  return { scale, x: x - (x - view.x) * k, y: y - (y - view.y) * k };
}

/** `view` bounded so at least KEEP pixels of the tree (or all of it, if smaller) stay in the frame. */
export function bounded(view: View, tree: Size, frame: Size): View {
  const axis = (at: number, content: number, room: number): number => {
    const keep = Math.min(KEEP, content);
    return Math.min(room - keep, Math.max(keep - content, at));
  };
  return { x: axis(view.x, tree.width * view.scale, frame.width), y: axis(view.y, tree.height * view.scale, frame.height), scale: view.scale };
}
