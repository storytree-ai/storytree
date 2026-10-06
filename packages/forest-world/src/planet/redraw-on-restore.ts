// World 6.15: a browser that takes the globe's WebGL context away (a busy or reset GPU) may hand it back.
// Three's renderer rebuilds its programs and buffers then, but nothing asks R3F for a frame, so a still
// globe stays blank until something moves. Kept apart from PlanetWorldCanvas.tsx so it is provable without
// a GPU (redraw-on-restore.test.ts); evidence/planet/context-loss.mjs loses the shipped canvas's context.
import type { RootState } from '@react-three/fiber';

/** Ask for one frame when `canvas` gets its WebGL context back; returns the stop. Off screen the frame
 * loop is "never" and the ask is dropped: coming back into view draws it (6.10). */
export function redrawOnRestore(root: () => Pick<RootState, 'invalidate'>, canvas: EventTarget): () => void {
  const restored = () => root().invalidate();
  canvas.addEventListener('webglcontextrestored', restored);
  return () => canvas.removeEventListener('webglcontextrestored', restored);
}
