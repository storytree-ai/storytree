// Capability 3 · Story node render

export type Detail = "territories" | "near" | "parts";
const LEVELS: readonly Detail[] = ["territories", "near", "parts"];

export const DETAIL_ZOOM = { near: 2, parts: 10 } as const;
export const DETAIL_SLACK = 0.12;

export function detailAt(zoom: number, was?: Detail): Detail {
  const shown = was === undefined ? undefined : LEVELS.indexOf(was);
  const past = (level: Exclude<Detail, "territories">) => {
    const slack = shown === undefined ? 0 : shown >= LEVELS.indexOf(level) ? -DETAIL_SLACK : DETAIL_SLACK;
    return zoom >= DETAIL_ZOOM[level] * (1 + slack);
  };
  return past("parts") ? "parts" : past("near") ? "near" : "territories";
}

export const showsNear = (level: Detail): boolean => level !== "territories";

export class DetailStore {
  private level: Detail | undefined;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly before: Detail = "territories") {}
  zoom(zoom: number): boolean {
    const next = detailAt(zoom, this.level);
    if (next === this.level) return false;
    this.level = next;
    for (const listener of this.listeners) listener();
    return true;
  }
  readonly get = (): Detail => this.level ?? this.before;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
}
