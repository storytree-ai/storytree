/** Forest capability 3: choose an artifact using pixels, independent of WebGL. */
export interface ProjectedNote {
  id: string;
  x: number;
  y: number;
  /** Normalized clip depth. */
  z: number;
  /** Distance along the picking ray, in the same units as the occluder. */
  distance: number;
  visible: boolean;
}

/** An eight-pixel target keeps faint dots easy to hit; land in front always wins. */
export function pickProjectedNote(notes: readonly ProjectedNote[], cursor: { x: number; y: number }, occluderDistance = Infinity): string | undefined {
  let best: ProjectedNote | undefined, closest = Infinity;
  for (const note of notes) {
    if (!note.visible || note.z < -1 || note.z > 1 || note.distance > occluderDistance) continue;
    const pixels = Math.hypot(note.x - cursor.x, note.y - cursor.y);
    if (pixels > 8) continue;
    if (pixels < closest || (pixels === closest && note.distance < (best?.distance ?? Infinity))) {
      closest = pixels;
      best = note;
    }
  }
  return best?.id;
}
