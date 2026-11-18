// Capability 4 · The planet
import type { RootState } from '@react-three/fiber';

export function redrawOnRestore(root: () => Pick<RootState, 'invalidate'>, canvas: EventTarget): () => void {
  const restored = () => root().invalidate();
  canvas.addEventListener('webglcontextrestored', restored);
  return () => canvas.removeEventListener('webglcontextrestored', restored);
}
