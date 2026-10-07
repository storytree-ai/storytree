// Capability 6 · The planet. World 6.10: the globe asks WebGL for frames only while some of its canvas is on screen. Kept apart from
// PlanetWorldCanvas.tsx so it is provable without a GPU (paint-while-seen.test.ts); evidence/planet/
// counts the shipped canvas's frames in Chromium.
import type { RootState } from '@react-three/fiber';

/** What pausing needs of an R3F root. */
export type PaintingRoot = Pick<RootState, 'frameloop' | 'setFrameloop' | 'clock' | 'internal'>;

/** Calls `seen` with whether any of `element` is in the viewport, at once and whenever that changes; returns its stop. */
export type ViewportWatch = (element: Element, seen: (seen: boolean) => void) => () => void;

/** The browser's own watch, or undefined where it cannot say what is on screen. */
export function viewportWatch(): ViewportWatch | undefined {
  if (typeof IntersectionObserver !== 'function') return undefined;
  return (element, seen) => {
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]!;
      // A canvas touching the viewport's edge intersects it with no area, and none of it can be seen.
      seen(entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
    // The second threshold reports the step from touching the edge to showing a sliver.
    }, { threshold: [0, 1e-6] });
    observer.observe(element);
    return () => observer.disconnect();
  };
}

/** Paused until the watch says the canvas can be seen; on demand, as before, where nothing can watch. */
export function startingFrameloop(watch: ViewportWatch | undefined): PaintingRoot['frameloop'] {
  return watch ? 'never' : 'demand';
}

/**
 * Pause the root's frameloop while none of `canvas` is on screen, and resume it as soon as any of it is.
 * The scene and camera are untouched, so the globe comes back as it was. Returns the stop.
 */
export function paintWhileSeen(root: () => PaintingRoot, canvas: Element, watch: ViewportWatch | undefined): () => void {
  if (!watch) return () => {};
  return watch(canvas, seen => {
    const state = root();
    if ((state.frameloop !== 'never') === seen) return;
    const { clock } = state;
    const elapsed = clock.getElapsedTime();
    // A frame an animation already asked for would still be drawn after the loop stops.
    if (!seen) state.internal.frames = 0;
    state.setFrameloop(seen ? 'demand' : 'never');
    // setFrameloop stops the clock and sets it back to zero, which would restart recorded growth, so it
    // keeps running from where it was. Under "never" only R3F's advance() would set it, and nothing calls that.
    clock.start();
    clock.elapsedTime = elapsed;
  });
}
