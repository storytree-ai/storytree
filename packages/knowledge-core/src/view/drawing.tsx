/**
 * The knowledge core's drawing (the knowledge core story, capability 4 · Look inside and inspect a note): the
 * pinned note's summary card, mounted in the globe's right-hand story-panel slot. The notes themselves
 * are drawn under the islands by `GlobePoints`.
 */
import React from "react";

import type { Card } from "../look-inside/look-inside.js";

/** The pinned note's summary card. */
export function NoteCard({ card, onClose }: { card: Card; onClose: () => void }) {
  return <section className="core-card" aria-label="Library panel">
    <p className="core-card-kind">{card.kind}</p>
    <header>
      <h3>{card.title}</h3>
      <button type="button" className="panel-close" aria-label="Close the library panel" onClick={onClose}>×</button>
    </header>
    <p className="core-card-text">{card.summary ?? card.text}</p>
  </section>;
}
