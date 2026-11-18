// Capability 3 · Story node render
import React from "react";
import type { SheetFace } from "./globe-switches.js";

export const LIBRARY_BAR_AFTER_MS = 330;

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

export function LibraryProgress({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return <div className="forest-library-progress" role="progressbar" aria-label="Opening the library" aria-busy="true" />;
}
