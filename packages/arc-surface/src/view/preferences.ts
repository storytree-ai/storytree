/** Capability 3 · Arc surface. */
import type { BoardScope } from "../board/board.js";

/** Only the scope is kept: an arc is selected by its row's click alone, so no picked arc is restored (3.7). */
export interface ArcPreferences { scope: BoardScope }
const key = (project: string) => `storytree.arc-surface.v1:${project}`;
/** Browser-local viewer state; no library write, and a denied or old value cannot stop a reading. */
export function readPreferences(project: string): ArcPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(project)) ?? "null");
    if (value && typeof value === "object") {
      const saved = value as Record<string, unknown>;
      return { scope: saved.scope === "parked" || saved.scope === "closed" ? saved.scope : "active" };
    }
  } catch { /* Storage is optional; the surface remains usable without it. */ }
  return { scope: "active" };
}
export function writePreferences(project: string, value: ArcPreferences): void {
  try { localStorage.setItem(key(project), JSON.stringify(value)); } catch { /* Keep this launch's state. */ }
}
