/**
 * The drill-down's panel (the forest story, capability 4): @storytree/forest's drillDown, as HTML.
 * It explains the story in plain words and draws its capability tree, which opens in its own space
 * (ADR-0743). Each of the story's own capabilities is a card you can click; the one selected shows
 * below the tree, with its health as the agent reports it and its contracts on request (ADR-0659).
 * Every word from the library is written as text, never as HTML.
 */
import { CARD, layoutTree, OUTSIDE_CARD, type CapabilityLine, type Card, type StoryPanel } from "@storytree/forest";
import type { HealthState } from "@storytree/library";

const HEALTH: Readonly<Record<HealthState, string>> = { passing: "passing", failing: "failing", "not-checked": "not checked" };

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
      <h3>${text(line.title)} <span class="panel-state status-${line.status}">${line.status}</span></h3>
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
 * The diagram: the capability tree as 0.2 drew it (ADR-0743), laid out by `layoutTree`: one card
 * per capability, what it builds on below it, each card with a strip across its top saying its word
 * (proposed, healthy, unhealthy or untested, ADR-0744) in 0.2's colours, and the agent's report and
 * storytree's as labelled marks (ADR-0630). In the panel it has its own framed space, where it is drawn at a
 * readable size and pans and zooms (`attachPanZoom`); a pop-out icon in the frame's corner, outside
 * the frame so pressing it starts no drag, opens the same tree in a larger window (`mountTreeSpace`).
 * The story's own cards are buttons, and `selected` is marked; another story's card is muted, names
 * its story, and is not a button (ADR-0659 D3, D5).
 */
function diagram(panel: StoryPanel, selected: string | undefined): string {
  return `
    <div class="panel-tree">
      <div class="panel-tree-frame">
        <div class="panel-tree-surface">
          ${renderTree(panel, selected, "panel-diagram")}
        </div>
      </div>
      <button type="button" class="panel-tree-pop-out" data-open-tree aria-label="${POP_OUT}" title="${POP_OUT}">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" /></svg>
      </button>
    </div>`;
}

const POP_OUT = "Open in a larger window";

/** The capability tree of `panel` as an SVG of class `kind`, at its natural size: 1 unit is 1 pixel. */
export function renderTree(panel: StoryPanel, selected: string | undefined, kind: string): string {
  const layout = layoutTree(panel);
  const head = `${kind}-head`;
  const cards = layout.cards.map((card) => cardOf(card, card.id === selected));
  const links = layout.links.map(({ d }) => `<path class="arrow" d="${d}" marker-end="url(#${head})" />`);
  return `
    <svg class="${kind}" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="How the capabilities connect">
      <defs><marker id="${head}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
      ${links.join("")}
      ${cards.join("")}
    </svg>`;
}

/** One card: a strip saying its word, its title (and story, if another's), and its health marks. */
function cardOf(card: Card, selected: boolean): string {
  const { width: W, height: H } = card;
  const S = card.own ? CARD.strip : OUTSIDE_CARD.strip;
  const title = card.own ? card.title : `${card.story ?? ""} · ${card.title}`;
  const classes = ["box", `status-${card.status}`, ...(card.own ? [] : ["elsewhere"]), ...(selected ? ["selected"] : [])];
  const pressable = card.own ? ` data-capability-id="${attribute(card.id)}" role="button" tabindex="0" aria-pressed="${selected}"` : "";
  const lines = [...(card.own ? [] : [{ words: card.story ?? "", kind: "card-story" }]), ...wrap(card.title, card.own ? 28 : 24, card.own ? 2 : 1).map((words) => ({ words, kind: "card-title" }))];
  const marks = [
    ...(card.reported === undefined ? [] : [mark("the agent reports", card.reported)]),
    ...(card.verified === undefined ? [] : [mark("storytree saw", card.verified)]),
  ];
  return `<g class="${classes.join(" ")}"${pressable} transform="translate(${card.x.toFixed(1)} ${card.y.toFixed(1)})">
      <title>${text(title)}</title>
      <rect class="card-bg" width="${W}" height="${H}" rx="7" />
      <path class="card-strip" d="M 0 ${S} L 0 7 Q 0 0 7 0 L ${W - 7} 0 Q ${W} 0 ${W} 7 L ${W} ${S} Z" />
      <text class="card-status" x="8" y="${S - 5}">${card.status}</text>
      ${lines.map(({ words, kind }, index) => `<text class="${kind}" x="${W / 2}" y="${S + (card.own ? 17 : 15) + index * 15}">${text(words)}</text>`).join("")}
      ${marks.map((each, index) => each.replace("<text ", `<text x="8" y="${H - 8 - (marks.length - 1 - index) * 14}" `)).join("")}
    </g>`;
}

const SIGN: Readonly<Record<HealthState, string>> = { passing: "✓", failing: "✗", "not-checked": "–" };

function mark(who: string, state: HealthState): string {
  return `<text class="card-mark mark-${state}">${SIGN[state]} ${text(who)}: ${HEALTH[state]}</text>`;
}

/** `words` in at most `most` lines of about `width` characters, the last cut short with an ellipsis. */
function wrap(words: string, width: number, most: number): string[] {
  const lines: string[] = [];
  let rest = words.trim();
  while (rest.length > 0 && lines.length < most) {
    if (rest.length <= width) {
      lines.push(rest);
      rest = "";
      break;
    }
    const cut = rest.lastIndexOf(" ", width);
    const at = cut < width * 0.4 ? width : cut;
    lines.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.length > 0 && lines.length > 0) lines[lines.length - 1] = shorten(`${lines.at(-1)} ${rest}`, width);
  return lines;
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
