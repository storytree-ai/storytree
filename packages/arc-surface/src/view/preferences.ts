// Capability 3 · Arc surface.
import type { BoardScope } from "../board/board.js";

export interface ArcPreferences { scope: BoardScope }
const key = (project: string) => `storytree.arc-surface.v1:${project}`;
export function readPreferences(project: string): ArcPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(project)) ?? "null");
    if (value && typeof value === "object") {
      const saved = value as Record<string, unknown>;
      return { scope: saved.scope === "parked" || saved.scope === "closed" ? saved.scope : "active" };
    }
  } catch {}
  return { scope: "active" };
}
export function writePreferences(project: string, value: ArcPreferences): void {
  try { localStorage.setItem(key(project), JSON.stringify(value)); } catch {}
}
