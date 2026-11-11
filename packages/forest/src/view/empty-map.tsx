/**
 * Capability 3 · Story node render: what the map says while its project has no story (3.107). Fable's first judged run
 * (research_e16161487f5a, F1.1) found a dark, empty map once Help was closed, the sentence that explains it left in the
 * Help page just closed: the map now says it, and offers the way back to the first-run guide.
 */
import React from "react";
import type { SheetFace } from "./globe-switches.js";

/**
 * The empty map's words, once the project is `read` and has no story, on the Stories face, with a button to the
 * first-run guide where the frame gives `onGuide`; nothing otherwise, so the first story's arrival takes it away.
 */
export function EmptyMap({ read, face, islands, onGuide }: { read: boolean; face: SheetFace; islands: number; onGuide?: (() => void) | undefined }) {
  if (!read || face !== "stories" || islands > 0) return null;
  return <div className="forest-empty-map" role="note">
    <p><strong>Nothing on the map yet.</strong></p>
    <p>Stories and their parts appear here as your agent plans them: start your coding agent in this project's folder and give it a small piece of work.</p>
    {onGuide !== undefined && <button type="button" onClick={onGuide}>First-run guide</button>}
  </div>;
}
