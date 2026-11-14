/**
 * Capability 3 · Story node render. A shared store's panel (ADR-1332 D1, D2): its address and medium, the evidence that
 * names it (the files and what in each names it, never drawn as nodes on the map), who touches it, and its tables, each
 * with its columns and foreign keys. Who touches it is each capability the mapping agent linked to this store's tables,
 * with the direction and the file and line it cites, said as judged (ADR-1332 D2 (4), ADR-1333 D2), or not yet read
 * while none is. Every word from the files is written as text, never as HTML.
 */
import type { SharedStore, StoreLink, StoreTable } from "@storytree/library";

/** The plan's capabilities, as far as the panel reads them: each one's title and judged store links. */
export type StorePlan = { readonly stories: readonly { readonly capabilities: readonly { readonly title: string; readonly storeLinks?: readonly StoreLink[] }[] }[] };

const DIRECTIONS: Readonly<Record<StoreLink["direction"], string>> = { read: "reads", write: "writes", both: "reads and writes", unknown: "touches" };

export function renderStorePanel(store: SharedStore, plan: StorePlan = { stories: [] }): string {
  return `
    <header class="panel-head" data-surface-id="store-panel" data-surface-layer="panel">
      <div class="panel-titles"><span class="panel-story-name">Shared store · ${text(store.medium)}</span><h2>${text(store.address)}</h2></div>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>
    <section class="panel-store-evidence" aria-label="Evidence"><h3>Named by</h3><ul>${store.evidence
      .map(({ file, says }) => `<li><code>${text(file)}</code> ${text(says)}</li>`).join("")}</ul></section>
    ${touches(store.address, plan)}
    ${store.tables.length === 0 ? "" : `<section class="panel-store-tables" aria-label="Tables"><h3>Tables · ${store.tables.length}</h3><ul>${store.tables.map(table).join("")}</ul></section>`}`;
}

/** Who touches the store: each capability's links to it, judged by the mapping agent, or not yet read when none is. */
function touches(address: string, plan: StorePlan): string {
  const lines = plan.stories.flatMap((story) => story.capabilities).flatMap(({ title, storeLinks = [] }) => storeLinks
    .filter((link) => link.store === address)
    .map(({ table, direction, cites }) => `<li>${text(title)} ${DIRECTIONS[direction]} <strong>${text(table)}</strong> <span class="panel-muted">${cites.map((cite) => `<code>${text(cite)}</code>`).join(", ")}</span></li>`));
  if (lines.length === 0) return `<p class="panel-muted">Who touches it: not yet read.</p>`;
  return `<section class="panel-store-touches" aria-label="Who touches it"><h3>Who touches it · judged by the mapping agent</h3><ul>${lines.join("")}</ul></section>`;
}

function table({ name, columns, foreignKeys }: StoreTable): string {
  const keys = foreignKeys.map((key) => `<li>${text(key.columns.join(", "))} → ${text(key.table)}${key.references.length === 0 ? "" : ` (${text(key.references.join(", "))})`}</li>`).join("");
  return `<li><strong>${text(name)}</strong><ul class="panel-store-columns">${columns.map((column) => `<li>${text(column.name)} <span class="panel-muted">${text(column.type)}</span></li>`).join("")}</ul>${keys === "" ? "" : `<ul class="panel-store-keys">${keys}</ul>`}</li>`;
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
