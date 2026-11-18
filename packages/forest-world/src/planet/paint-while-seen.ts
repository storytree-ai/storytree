// Capability 4 · The planet
import type { RootState } from '@react-three/fiber';

export type PaintingRoot = Pick<RootState, 'frameloop' | 'setFrameloop' | 'clock' | 'internal'>;

export type ViewportWatch = (element: Element, seen: (seen: boolean) => void) => () => void;

export function viewportWatch(): ViewportWatch | undefined {
  if (typeof IntersectionObserver !== 'function') return undefined;
  return (element, seen) => {
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]!;
      seen(entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
    }, { threshold: [0, 1e-6] });
    observer.observe(element);
    return () => observer.disconnect();
  };
}

export function startingFrameloop(watch: ViewportWatch | undefined): PaintingRoot['frameloop'] {
  return watch ? 'never' : 'demand';
}

export function paintWhileSeen(root: () => PaintingRoot, canvas: Element, watch: ViewportWatch | undefined): () => void {
  if (!watch) return () => {};
  return watch(canvas, seen => {
    const state = root();
    if ((state.frameloop !== 'never') === seen) return;
    const { clock } = state;
    const elapsed = clock.getElapsedTime();
    if (!seen) state.internal.frames = 0;
    state.setFrameloop(seen ? 'demand' : 'never');
    clock.start();
    clock.elapsedTime = elapsed;
  });
}
