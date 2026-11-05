/**
 * Capability 3 · Story node render. Which of an island's marks the map shows at the eye's zoom (3.86, ADR-1253 D2): from
 * far, the islands, their names and the sea lanes; nearer, the territories; near, the roads, gates, relief and settlements.
 * Every island is drawn in its one kept layout at every level, so a change of level shows or hides marks and never moves one.
 */

/** How much of the islands' detail shows, from least to most. */
export type Detail = "far" | "territories" | "near";

const LEVELS: readonly Detail[] = ["far", "territories", "near"];

/**
 * Where the levels change, on the eye's zoom in CSS pixels per ground unit at the middle of the view (`sheetEyeZoom`),
 * measured on storytree's own map in the real app (evidence/zoom-detail): the territories show from `territories` of the
 * zoom that frames the whole map, so the map always opens on them and the wheel, which stops at half that zoom, always
 * reaches far; the near marks show from `near`, where a gate stands about 8 pixels long, on any map.
 */
export const DETAIL_ZOOM = { territories: 0.75, near: 2 } as const;
/** How far past a threshold, as a fraction of it, the zoom must go to change the level, either way, so a zoom resting on
 * a threshold does not flicker. */
export const DETAIL_SLACK = 0.12;

/** The level shown at `zoom` on a map `whole` frames whole, having shown `was`: it changes only once the zoom is past a
 * threshold by its slack. With nothing shown yet, the level the thresholds alone give. */
export function detailAt(zoom: number, whole: number, was?: Detail): Detail {
  const thresholds = [Math.min(whole * DETAIL_ZOOM.territories, DETAIL_ZOOM.near), DETAIL_ZOOM.near];
  if (was === undefined) return LEVELS[thresholds.filter(threshold => zoom >= threshold).length]!;
  let level = LEVELS.indexOf(was);
  while (level < thresholds.length && zoom >= thresholds[level]! * (1 + DETAIL_SLACK)) level++;
  while (level > 0 && zoom < thresholds[level - 1]! * (1 - DETAIL_SLACK)) level--;
  return LEVELS[level]!;
}

/** Whether marks shown from `from` show at `detail`. */
export const shows = (detail: Detail, from: Detail): boolean => LEVELS.indexOf(detail) >= LEVELS.indexOf(from);

/** The level the map shows now, fed the eye's zoom each frame; it tells its listeners only when the level changes. */
export class DetailStore {
  private level: Detail | undefined;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly before: Detail = "territories") {}
  /** Reads `zoom` on a map `whole` frames whole; whether the level changed. */
  zoom(zoom: number, whole: number): boolean {
    const next = detailAt(zoom, whole, this.level);
    if (next === this.level) return false;
    this.level = next;
    for (const listener of this.listeners) listener();
    return true;
  }
  /** The level shown, or the one shown before the eye's first zoom is read. */
  readonly get = (): Detail => this.level ?? this.before;
  /** Hears each change of level (React's useSyncExternalStore, with `get`). */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
}
