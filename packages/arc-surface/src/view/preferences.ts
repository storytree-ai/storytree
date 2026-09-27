import type { BoardScope } from "../board/board.js";

export interface DrawerPreferences { open: boolean; scope: BoardScope; picked?: string }
const key = (project: string) => `storytree.arc-surface.v1:${project}`;
/** Browser-local viewer state; no library write, and a denied or old value cannot stop a reading. */
export function readPreferences(project: string): DrawerPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(project)) ?? "null");
    if (value && typeof value === "object") {
      const saved = value as Record<string, unknown>;
      return { open: saved.open === true, scope: saved.scope === "parked" || saved.scope === "closed" ? saved.scope : "active",
        ...(typeof saved.picked === "string" ? { picked: saved.picked } : {}) };
    }
  } catch { /* Storage is optional; the surface remains usable without it. */ }
  return { open: false, scope: "active" };
}
export function writePreferences(project: string, value: DrawerPreferences): void {
  try { localStorage.setItem(key(project), JSON.stringify(value)); } catch { /* Keep this launch's state. */ }
}
