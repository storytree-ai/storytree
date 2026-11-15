/**
 * Capability 3 · Story node render: the loading bar a slow press of Library shows (3.116, ADR-1344). The notes are read and laid
 * out only when Library is pressed (ADR-1340), so an open can take a moment: past about a third of a second the bar shows, so a
 * quick open never flashes one, and it leaves once the notes are hung beneath the glass or Stories is pressed again.
 */
import React from "react";
import type { SheetFace } from "./globe-switches.js";

/** How long an open of the Library runs before its bar shows (owner, 2026-11-15: "about a third of a second"). */
export const LIBRARY_BAR_AFTER_MS = 330;

/** The Library's opening: told each face pressed and when the notes are hung, it tells `bar` when to show the bar and when to take it away. */
export function libraryOpening(bar: (shown: boolean) => void, after = LIBRARY_BAR_AFTER_MS): { turned(face: SheetFace): void; hung(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined, shown = false;
  const done = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (shown) { shown = false; bar(false); }
  };
  return {
    turned(face) {
      if (face !== "library") { done(); return; }
      if (timer !== undefined || shown) return;
      timer = setTimeout(() => { timer = undefined; shown = true; bar(true); }, after);
    },
    hung: done,
  };
}

/** The bar itself, in the look of the app's start bar (#start-progress): a progress bar the lag instruments credit (role=progressbar). */
export function LibraryProgress({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return <div className="forest-library-progress" role="progressbar" aria-label="Opening the library" aria-busy="true" />;
}
