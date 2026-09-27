/**
 * The drill-down's panel (stories/forest.md, capability 4): @storytree/forest's drillDown, as HTML.
 * It explains the story in plain words, then each capability with its health as the agent reports
 * it, and its contracts on request, with a small diagram of which capability builds on which. Inside
 * it, the story's and each capability's shelf of front covers shows as spines (capability 7), and the
 * book opened shows its text and the titles of its links, one step in and no further. Every word from
 * the library is written as text, never as HTML.
 */
import type { Arrow, Book, CapabilityLine, Shelf, StoryPanel } from "@storytree/forest";
import type { HealthState } from "@storytree/library";

const HEALTH: Readonly<Record<HealthState, string>> = { passing: "passing", failing: "failing", "not-checked": "not checked" };
const STATE = { planned: "planned", "in-progress": "in progress", landed: "landed" } as const;

/** The panel's HTML, with `book` open on its shelf, if one is. */
export function renderStoryPanel(panel: StoryPanel, book?: Book): string {
  return `
    <header class="panel-head">
      <h2>${text(panel.title)}</h2>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>
    <p class="panel-sentences">${text(panel.description)}</p>
    ${shelf(panel.shelf, book)}
    ${panel.capabilities.length === 0 ? "" : diagram(panel)}
    <ol class="panel-capabilities">
      ${panel.capabilities.map((line) => capability(line, book)).join("")}
    </ol>`;
}

/** A shelf: its spines, each a button that opens its book, or what an empty shelf says. Nothing until it is read. */
function shelf(on: Shelf | undefined, book: Book | undefined): string {
  if (on === undefined) return "";
  const spines = on.spines.map((spine) => {
    const open = book?.id === spine.id;
    return `
      <li>
        <button type="button" class="panel-spine" data-book-id="${attribute(spine.id)}" aria-expanded="${open}">
          <span class="spine-title">${text(spine.title)}</span>${spine.founding ? ` <span class="spine-founding">founding book</span>` : ""}
          <span class="spine-line">${text(spine.firstLine)}</span>
        </button>
        ${open && book !== undefined ? opened(book) : ""}
      </li>`;
  });
  return `
    <section class="panel-shelf" data-shelf="${attribute(on.node)}">
      <h4>Front covers</h4>
      ${on.empty === undefined ? `<ol class="panel-spines">${spines.join("")}</ol>` : `<p class="panel-muted">${text(on.empty)}</p>`}
    </section>`;
}

/** A book opened: its text, then the titles of what links to it and of what it links to. */
function opened(book: Book): string {
  const titles = (label: string, list: readonly string[], none: string): string => `
    <p class="panel-muted">${text(label)}</p>
    ${list.length === 0 ? `<p class="panel-muted">${text(none)}</p>` : `<ul class="panel-links">${list.map((title) => `<li>${text(title)}</li>`).join("")}</ul>`}`;
  return `
    <div class="panel-book">
      ${book.text.split(/\n\s*\n/).map((paragraph) => `<p>${text(paragraph)}</p>`).join("")}
      ${titles("Linked from", book.linksIn, "No artifact links here yet.")}
      ${titles("Links to", book.linksOut, "It links to no artifact.")}
    </div>`;
}

function capability(line: CapabilityLine, book: Book | undefined): string {
  const contracts = line.contracts.length === 0
    ? `<p class="panel-muted">No contracts yet.</p>`
    : `<ul class="panel-contracts">${line.contracts
        .map(
          (contract) => `
            <li data-contract-id="${attribute(contract.id)}">
              <span>${text(contract.title)}</span>
              <span class="panel-health">
                ${badge("the agent reports", contract.reported)}
                <span class="panel-trail">${text(contract.trail)}</span>
                ${contract.verified === undefined ? "" : badge("storytree saw", contract.verified)}
              </span>
            </li>`,
        )
        .join("")}</ul>`;
  return `
    <li class="panel-capability" data-capability-id="${attribute(line.id)}">
      <h3>${text(line.title)} <span class="panel-state">${STATE[line.state]}</span></h3>
      <p>${text(line.description)}</p>
      <p class="panel-health">
        ${badge("the agent reports", line.reported)}
        ${line.verified === undefined ? "" : badge("storytree saw", line.verified)}
      </p>
      <details><summary>${line.contracts.length} contract${line.contracts.length === 1 ? "" : "s"}</summary>${contracts}</details>
      ${shelf(line.shelf, book)}
    </li>`;
}

function badge(who: string, state: HealthState): string {
  return `<span class="panel-badge badge-${state}">${text(who)}: ${HEALTH[state]}</span>`;
}

/**
 * The diagram: one box per capability, in columns by how deep it builds (a capability sits one
 * column right of the deepest one it builds on in the story), with any capability of another story
 * it builds on in a column of its own at the left, named with its story and dashed until it lands.
 */
function diagram(panel: StoryPanel): string {
  const own = new Map(panel.capabilities.map((line) => [line.id, line]));
  const outside = new Map<string, Arrow>();
  for (const arrow of panel.arrows) if (!own.has(arrow.to)) outside.set(arrow.to, arrow);

  const depth = new Map<string, number>();
  for (const line of panel.capabilities) {
    const on = panel.arrows.filter(({ from, to }) => from === line.id && own.has(to)).map(({ to }) => depth.get(to) ?? 0);
    depth.set(line.id, on.length === 0 ? 0 : Math.max(...on) + 1);
  }
  const shift = outside.size === 0 ? 0 : 1;
  const columns = new Map<number, string[]>();
  const place = (id: string, column: number): void => {
    columns.set(column, [...(columns.get(column) ?? []), id]);
  };
  for (const id of outside.keys()) place(id, 0);
  for (const line of panel.capabilities) place(line.id, (depth.get(line.id) ?? 0) + shift);

  const W = 120;
  const H = 34;
  const GAP_X = 40;
  const GAP_Y = 14;
  const at = new Map<string, { x: number; y: number }>();
  for (const [column, ids] of columns) ids.forEach((id, row) => at.set(id, { x: column * (W + GAP_X), y: row * (H + GAP_Y) }));
  const width = Math.max(...[...at.values()].map(({ x }) => x)) + W;
  const height = Math.max(...[...at.values()].map(({ y }) => y)) + H;

  const boxes = [...at].map(([id, { x, y }]) => {
    const line = own.get(id);
    const arrow = outside.get(id);
    const title = line?.title ?? `${arrow?.toStory ?? ""} · ${arrow?.toTitle ?? id}`;
    const pending = line === undefined ? arrow?.landed !== true : line.state !== "landed";
    return `<g class="box${pending ? " pending" : ""}${line === undefined ? " elsewhere" : ""}">
      <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="6" />
      <text x="${x + W / 2}" y="${y + H / 2 + 4}">${text(shorten(title, 18))}</text>
      <title>${text(title)}${pending ? " (not landed yet)" : ""}</title>
    </g>`;
  });
  const arrows = panel.arrows.map(({ from, to }) => {
    const a = at.get(from);
    const b = at.get(to);
    if (a === undefined || b === undefined) return "";
    return `<path class="arrow" d="M ${a.x} ${a.y + H / 2} C ${a.x - GAP_X / 2} ${a.y + H / 2}, ${b.x + W + GAP_X / 2} ${b.y + H / 2}, ${b.x + W + 4} ${b.y + H / 2}" marker-end="url(#head)" />`;
  });
  return `
    <svg class="panel-diagram" viewBox="-6 -6 ${width + 12} ${height + 12}" width="${width + 12}" height="${height + 12}" role="img" aria-label="How the capabilities connect">
      <defs><marker id="head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
      ${arrows.join("")}
      ${boxes.join("")}
    </svg>`;
}

function shorten(words: string, most: number): string {
  return words.length <= most ? words : `${words.slice(0, most - 1)}…`;
}

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attribute(value: string): string {
  return text(value).replace(/"/g, "&quot;");
}
