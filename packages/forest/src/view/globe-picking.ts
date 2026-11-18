// Capability 3 · Story node render
export interface ProjectedNote {
  id: string;
  x: number;
  y: number;
  z: number;
  distance: number;
  visible: boolean;
}

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
