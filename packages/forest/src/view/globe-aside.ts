// Capability 3 · Story node render

import { Vector3, type Camera, type Object3D } from "three";

export type AsidePose = { framing: number; sideOffset: number };
type Viewport = { width: number; height: number };

const FIT_MARGIN = 12;
const USEFUL_FREE = 160;

export function besidePanel(viewport: Viewport, aside: number, rest: AsidePose, fit = true): AsidePose {
  const free = viewport.width - aside;
  if (aside <= 0 || free < Math.max(USEFUL_FREE, viewport.width / 4)) return rest;
  if (!fit) return { sideOffset: rest.sideOffset - aside / 2, framing: rest.framing };
  const whole = Math.min(viewport.width, viewport.height) / (free - 2 * FIT_MARGIN);
  return { sideOffset: rest.sideOffset - aside / 2, framing: Math.max(rest.framing, whole) };
}

export function islandCanvasX(scene: Object3D, camera: Camera, story: string | undefined, width: number): number | undefined {
  const island = story === undefined ? undefined : scene.getObjectByName(`planet:${story}`);
  return island && (island.getWorldPosition(new Vector3()).project(camera).x + 1) * width / 2;
}

export function panelAside(page: { right: number }, boxes: readonly { left: number }[]): number {
  if (boxes.length === 0) return 0;
  return Math.max(0, page.right - Math.min(...boxes.map(box => box.left)));
}

export function framedOnResize(pose: AsidePose, from: Viewport & { left: number }, to: Viewport & { left: number }): AsidePose | undefined {
  if (from.width === to.width && from.height === to.height && from.left === to.left) return undefined;
  const framing = pose.framing * Math.min(to.width, to.height) / Math.max(Math.min(from.width, from.height), 1);
  const grown = (to.width - from.width) / 2;
  return { framing, sideOffset: pose.sideOffset + (to.left !== from.left ? grown : -grown) };
}

export function createGlobeAside(opening: () => AsidePose, { fit = true }: { fit?: boolean } = {}) {
  let covered = 0, seen: Viewport | undefined;
  let fitted: { from: number; to: number } | undefined;
  let slid = 0;
  const slide = (viewport: Viewport, aside: number): number => besidePanel(viewport, aside, { framing: 1, sideOffset: 0 }).sideOffset;
  const settle = (viewport: Viewport, rest: AsidePose): AsidePose => {
    const to = besidePanel(viewport, covered, rest, fit);
    fitted = to.framing > rest.framing ? { from: rest.framing, to: to.framing } : undefined;
    return to;
  };
  return {
    place(viewport: Viewport, aside: number, now: AsidePose, picked?: number): { to: AsidePose; glide: boolean } | undefined {
      const resized = seen !== undefined && (seen.width !== viewport.width || seen.height !== viewport.height);
      if (aside === covered && (!resized || aside === 0)) { seen = viewport; return undefined; }
      const glide = aside !== covered;
      seen = viewport;
      if (!fit) {
        if (!glide) return undefined;
        covered = aside;
        const half = slide(viewport, aside);
        const by = half !== 0 && picked !== undefined ? slid + (viewport.width - aside) / 2 - picked : half;
        const to = { framing: now.framing, sideOffset: now.sideOffset + by - slid };
        slid = by;
        return to.sideOffset === now.sideOffset ? undefined : { to, glide };
      }
      covered = aside;
      const ours = fitted !== undefined && Math.abs(now.framing - fitted.to) < 1e-6;
      const to = settle(viewport, { framing: ours ? fitted!.from : now.framing, sideOffset: opening().sideOffset });
      return to.framing === now.framing && to.sideOffset === now.sideOffset ? undefined : { to, glide };
    },
    home(viewport: Viewport): AsidePose {
      seen = viewport;
      slid = slide(viewport, covered);
      return settle(viewport, opening());
    },
  };
}
