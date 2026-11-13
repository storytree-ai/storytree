/**
 * Capability 3 · Story node render. A shared store's panel (ADR-1332 D1, D2): its address and medium, the evidence that
 * names it (the files and what in each names it, never drawn as nodes on the map), who touches it, which no layer has
 * read yet, and its tables, each with its columns and foreign keys. Every word from the files is written as text, never as HTML.
 */
import type { SharedStore, StoreTable } from "@storytree/library";

export function renderStorePanel(store: SharedStore): string {
  return `
    <header class="panel-head" data-surface-id="store-panel" data-surface-layer="panel">
      <div class="panel-titles"><span class="panel-story-name">Shared store · ${text(store.medium)}</span><h2>${text(store.address)}</h2></div>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>
    <section class="panel-store-evidence" aria-label="Evidence"><h3>Named by</h3><ul>${store.evidence
      .map(({ file, says }) => `<li><code>${text(file)}</code> ${text(says)}</li>`).join("")}</ul></section>
    <p class="panel-muted">Who touches it: not yet read.</p>
    ${store.tables.length === 0 ? "" : `<section class="panel-store-tables" aria-label="Tables"><h3>Tables · ${store.tables.length}</h3><ul>${store.tables.map(table).join("")}</ul></section>`}`;
}

function table({ name, columns, foreignKeys }: StoreTable): string {
  const keys = foreignKeys.map((key) => `<li>${text(key.columns.join(", "))} → ${text(key.table)}${key.references.length === 0 ? "" : ` (${text(key.references.join(", "))})`}</li>`).join("");
  return `<li><strong>${text(name)}</strong><ul class="panel-store-columns">${columns.map((column) => `<li>${text(column.name)} <span class="panel-muted">${text(column.type)}</span></li>`).join("")}</ul>${keys === "" ? "" : `<ul class="panel-store-keys">${keys}</ul>`}</li>`;
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
