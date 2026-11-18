// Capability 3 · Story node render
import React from "react";
import type { SheetFace } from "./globe-switches.js";

export function EmptyMap({ read, face, islands, onGuide }: { read: boolean; face: SheetFace; islands: number; onGuide?: (() => void) | undefined }) {
  if (!read || face !== "stories" || islands > 0) return null;
  return <div className="forest-empty-map" role="note">
    <p><strong>Nothing on the map yet.</strong></p>
    <p>Stories and their parts appear here as your agent plans them: start your coding agent in this project's folder and give it a small piece of work.</p>
    {onGuide !== undefined && <button type="button" onClick={onGuide}>First-run guide</button>}
  </div>;
}
