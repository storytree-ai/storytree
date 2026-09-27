/**
 * The drill-down's panel (the forest story, capability 4): @storytree/forest's drillDown, as HTML.
 * It explains the story in plain words and draws a small diagram of which capability builds on
 * which. Each of the story's own capabilities is a box you can click; the one selected shows below
 * the diagram, with its health as the agent reports it and its contracts on request (ADR-0659).
 * Every word from the library is written as text, never as HTML.
 */
import type { Arrow, CapabilityLine, StoryPanel } from "@storytree/forest";
import type { HealthState } from "@storytree/library";

const HEALTH: Readonly<Record<HealthState, string>> = { passing: "passing", failing: "failing", "not-checked": "not checked" };
const STATE = { planned: "planned", "in-progress": "in progress", landed: "landed" } as const;

/** The panel's HTML, with `selected` shown below the diagram, if it is one of the story's capabilities. */
export function renderStoryPanel(panel: StoryPanel, selected: string | undefined): string {
  const shown = panel.capabilities.find(({ id }) => id === selected);
  return `
    <header class="panel-head">
      <h2>${text(panel.title)}</h2>
      <button type="button" class="panel-close" aria-label="Close">×</button>
    </header>
    <p class="panel-sentences">${text(panel.description)}</p>
    ${panel.capabilities.length === 0 ? "" : diagram(panel, shown?.id)}
    ${shown === undefined ? "" : capability(shown)}`;
}

function capability(line: CapabilityLine): string {
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
    <section class="panel-detail" data-capability-id="${attribute(line.id)}">
      <h3>${text(line.title)} <span class="panel-state">${STATE[line.state]}</span></h3>
      <p>${text(line.description)}</p>
      <p class="panel-health">
        ${badge("the agent reports", line.reported)}
        ${line.verified === undefined ? "" : badge("storytree saw", line.verified)}
      </p>
      <details><summary>${line.contracts.length} contract${line.contracts.length === 1 ? "" : "s"}</summary>${contracts}</details>
    </section>`;
}

function badge(who: string, state: HealthState): string {
  return `<span class="panel-badge badge-${state}">${text(who)}: ${HEALTH[state]}</span>`;
}

/**
 * The diagram: one box per capability, in rows by how deep it builds (a capability sits one row
 * below the deepest one it builds on in the story), with any capability of another story it builds
 * on in a row of its own at the top, named with its story and dashed until it lands. Rows, not
 * columns, so a deep story stays readable in the narrow panel.
 * The story's own boxes are buttons, tinted by the agent's reported health, and `selected` is marked;
 * another story's box is muted and is not a button (ADR-0659 D3, D5).
 */
function diagram(panel: StoryPanel, selected: string | undefined): string {
  const own = new Map(panel.capabilities.map((line) => [line.id, line]));
  const outside = new Map<string, Arrow>();
  for (const arrow of panel.arrows) if (!own.has(arrow.to)) outside.set(arrow.to, arrow);

  const depth = new Map<string, number>();
  for (const line of panel.capabilities) {
    const on = panel.arrows.filter(({ from, to }) => from === line.id && own.has(to)).map(({ to }) => depth.get(to) ?? 0);
    depth.set(line.id, on.length === 0 ? 0 : Math.max(...on) + 1);
  }
  const shift = outside.size === 0 ? 0 : 1;
  const rows = new Map<number, string[]>();
  const place = (id: string, row: number): void => {
    rows.set(row, [...(rows.get(row) ?? []), id]);
  };
  for (const id of outside.keys()) place(id, 0);
  for (const line of panel.capabilities) place(line.id, (depth.get(line.id) ?? 0) + shift);

  const W = 132;
  const H = 32;
  const GAP_X = 12;
  const GAP_Y = 30;
  const at = new Map<string, { x: number; y: number }>();
  for (const [row, ids] of rows) ids.forEach((id, column) => at.set(id, { x: column * (W + GAP_X), y: row * (H + GAP_Y) }));
  const width = Math.max(...[...at.values()].map(({ x }) => x)) + W;
  const height = Math.max(...[...at.values()].map(({ y }) => y)) + H;

  const boxes = [...at].map(([id, { x, y }]) => {
    const line = own.get(id);
    const arrow = outside.get(id);
    const title = line?.title ?? `${arrow?.toStory ?? ""} · ${arrow?.toTitle ?? id}`;
    const pending = line === undefined ? arrow?.landed !== true : line.state !== "landed";
    const classes = ["box", ...(pending ? ["pending"] : []), ...(line === undefined ? ["elsewhere"] : [`health-${line.reported}`]), ...(id === selected ? ["selected"] : [])];
    const pressable = line === undefined ? "" : ` data-capability-id="${attribute(id)}" role="button" tabindex="0" aria-pressed="${id === selected}"`;
    return `<g class="${classes.join(" ")}"${pressable}>
      <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="6" />
      <text x="${x + W / 2}" y="${y + H / 2 + 4}">${text(shorten(title, 21))}</text>
      <title>${text(title)}${pending ? " (not landed yet)" : ""}</title>
    </g>`;
  });
  const arrows = panel.arrows.map(({ from, to }) => {
    const a = at.get(from);
    const b = at.get(to);
    if (a === undefined || b === undefined) return "";
    return `<path class="arrow" d="M ${a.x + W / 2} ${a.y} C ${a.x + W / 2} ${a.y - GAP_Y / 2}, ${b.x + W / 2} ${b.y + H + GAP_Y / 2}, ${b.x + W / 2} ${b.y + H + 4}" marker-end="url(#head)" />`;
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
