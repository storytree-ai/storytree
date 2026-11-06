/**
 * Capability 3 · Story node render. Which of an island's marks the map shows at the eye's zoom (3.86, ADR-1253 D2 as narrowed
 * by ADR-1272 D1): at every zoom, the islands, their names, the sea lanes and the territories in their health colours; near, the
 * roads, gates, relief, settlements and capability names too. Every island is drawn in its one kept layout at every level, so a
 * change of level shows or hides marks and never moves one.
 */

/** How much of the islands' detail shows, from least to most. */
export type Detail = "territories" | "near";

/**
 * Where the near marks show from, on the eye's zoom in CSS pixels per ground unit at the middle of the view (`sheetEyeZoom`),
 * measured on storytree's own map in the real app (evidence/zoom-detail): where a gate stands about 8 pixels long, on any map.
 */
export const DETAIL_ZOOM = { near: 2 } as const;
/** How far past the threshold, as a fraction of it, the zoom must go to change the level, either way, so a zoom resting on
 * it does not flicker. */
export const DETAIL_SLACK = 0.12;

/** The level shown at `zoom`, having shown `was`: it changes only once the zoom is past the threshold by its slack. With
 * nothing shown yet, the level the threshold alone gives. */
export function detailAt(zoom: number, was?: Detail): Detail {
  const slack = was === undefined ? 0 : was === "near" ? -DETAIL_SLACK : DETAIL_SLACK;
  return zoom >= DETAIL_ZOOM.near * (1 + slack) ? "near" : "territories";
}

/** The level the map shows now, fed the eye's zoom each frame; it tells its listeners only when the level changes. */
export class DetailStore {
  private level: Detail | undefined;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly before: Detail = "territories") {}
  /** Reads `zoom`; whether the level changed. */
  zoom(zoom: number): boolean {
    const next = detailAt(zoom, this.level);
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
