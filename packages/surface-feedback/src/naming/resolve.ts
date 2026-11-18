// Capability 2 · Surface naming

export interface DeclaredSurface {
  readonly id: string;
  readonly name: string;
  readonly story: string;
}

export interface NamedSurface {
  readonly id: string;
  readonly name: string;
}

export type SurfaceLayer = "overlay" | "panel";

const RANK: Readonly<Record<string, number>> = { panel: 1, overlay: 2 };
const TOP = 3;

export function surfaceInFront(document: Document): string | undefined {
  let front: { id: string; rank: number } | undefined;
  for (const element of document.querySelectorAll<HTMLElement>("[data-surface-id]")) {
    const id = element.dataset.surfaceId;
    if (id === undefined || id === "" || !onShow(element)) continue;
    const rank = inTopLayer(element) ? TOP : RANK[element.dataset.surfaceLayer ?? ""] ?? 0;
    if (front === undefined || rank >= front.rank) front = { id, rank };
  }
  return front?.id;
}

export function topLayerOf(element: Element): HTMLElement | undefined {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node instanceof HTMLDialogElement ? node.open : node.hasAttribute("popover") && node.matches(":popover-open")) return node as HTMLElement;
  }
  return undefined;
}

function inTopLayer(element: Element): boolean {
  return topLayerOf(element) !== undefined;
}

function onShow(element: HTMLElement): boolean {
  return element.checkVisibility() && element.getClientRects().length > 0;
}
