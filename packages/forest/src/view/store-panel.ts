/**
 * Capability 3 · Story node render. A shared store's panel (ADR-1332 D1, ADR-1347 D3): its address and medium, who
 * touches it, and its tables. A store is drawn only from the store links the mapping agent records, so who touches it is
 * each capability linked to this store's tables, with the direction and the file and line it cites, said as judged
 * (ADR-1332 D2 (4), ADR-1333 D2). Every word from the plan is written as text, never as HTML.
 */
import type { SharedStore, StoreLink } from "@storytree/library";

/** The plan's capabilities, as far as the panel reads them: each one's title and judged store links. */
export type StorePlan = { readonly stories: readonly { readonly capabilities: readonly { readonly title: string; readonly storeLinks?: readonly StoreLink[] }[] }[] };

const DIRECTIONS: Readonly<Record<StoreLink["direction"], string>> = { read: "reads", write: "writes", both: "reads and writes", unknown: "touches" };

export function renderStorePanel(store: SharedStore, plan: StorePlan = { stories: [] }): string {
  return `
    <header class="panel-head" data-surface-id="store-panel" data-surface-layer="panel">
      <div class="panel-titles"><span class="panel-story-name">Shared store · ${text(store.medium)}</span><h2>${text(store.address)}</h2></div>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>
    ${touches(store.address, plan)}
    ${store.tables.length === 0 ? "" : `<section class="panel-store-tables" aria-label="Tables"><h3>Tables · ${store.tables.length}</h3><ul>${store.tables.map(({ name }) => `<li><strong>${text(name)}</strong></li>`).join("")}</ul></section>`}`;
}

/** Who touches the store: each capability's links to it, judged by the mapping agent. */
function touches(address: string, plan: StorePlan): string {
  const lines = plan.stories.flatMap((story) => story.capabilities).flatMap(({ title, storeLinks = [] }) => storeLinks
    .filter((link) => link.store === address)
    .map(({ table, direction, cites }) => `<li>${text(title)} ${DIRECTIONS[direction]} <strong>${text(table)}</strong> <span class="panel-muted">${cites.map((cite) => `<code>${text(cite)}</code>`).join(", ")}</span></li>`));
  if (lines.length === 0) return "";
  return `<section class="panel-store-touches" aria-label="Who touches it"><h3>Who touches it · judged by the mapping agent</h3><ul>${lines.join("")}</ul></section>`;
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
