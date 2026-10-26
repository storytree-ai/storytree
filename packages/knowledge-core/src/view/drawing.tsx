/**
 * Capability 4 · Look inside and inspect an artifact. The knowledge core's drawing (the knowledge core story, capability 4 · Look inside and inspect a note): the
 * pinned note's summary card, mounted in the globe's right-hand story-panel slot. The notes themselves
 * are drawn under the islands by `GlobePoints`.
 */
import React from "react";

import type { KindRow } from "../kinds/kinds.js";
import type { Card } from "../look-inside/look-inside.js";

/** The kind list (capability 5): a press switches a kind's dots on or off. */
export function KindList({ rows, onShow }: { rows: readonly KindRow[]; onShow: (kind: string, shown: boolean) => void }) {
  return rows.length === 0 ? null : <div className="core-kinds" role="group" aria-label="Artifact kinds">
    {rows.map(({ kind, label, colour, count, shown }) => <button key={kind} type="button" data-kind={kind} aria-pressed={shown} onClick={() => onShow(kind, !shown)}>
      <span className="core-kind-swatch" style={{ background: colour }} />
      <span className="core-kind-label">{label}</span>
      <span className="core-kind-count">{count}</span>
    </button>)}
  </div>;
}

/** The pinned note's summary card. */
export function NoteCard({ card, onClose }: { card: Card; onClose: () => void }) {
  return <section className="core-card" aria-label="Library panel">
    <p className="core-card-kind">{card.kind}</p>
    <header>
      <h3>{card.title}</h3>
      <button type="button" className="panel-close" aria-label="Close the library panel" onClick={onClose}>×</button>
    </header>
    <p className="core-card-text">{card.summary ?? card.text}</p>
    {card.fromFactory === true ? <p className="core-card-from">From this project's factory</p> : null}
  </section>;
}
