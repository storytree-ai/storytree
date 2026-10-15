/**
 * Capability 3 · Cards and journal on screen. A fired card shows beside the thing it explains, one at a
 * time, and never takes focus or blocks the map; the journal lists the cards seen and shows one again.
 */
import { cardOf, type Card, type Kind } from "../cards.js";
import { encounters, type Encounter, type MapReading, type Target } from "../encounters.js";
import type { Journal } from "../journal.js";
import { decisionsDiagram } from "./diagram.js";

/** Where a target is on the page, in client pixels, or undefined when it is not drawn. */
export type Locate = (target: Target) => { x: number; y: number; visible: boolean } | undefined;

const STYLES = `
.teaching-card { position: fixed; z-index: 20; max-width: 22rem; padding: .75rem .9rem; border-radius: .6rem;
  background: rgba(20, 24, 32, .94); color: #f2f4f8; font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35);
  max-height: calc(100vh - 24px); overflow-y: auto; }
.teaching-card-corner { left: auto !important; top: auto !important; right: 1rem; bottom: 1rem; }
.teaching-card h3 { margin: 0 0 .25rem; font-size: 15px; }
.teaching-card p, .teaching-journal p { margin: .25rem 0; }
.teaching-card [data-depth] h4, .teaching-journal h4 { margin: .5rem 0 0; font-size: 13px; }
.teaching-card-actions { display: flex; gap: .5rem; margin-top: .5rem; }
.teaching-journal ol { padding-left: 1.25rem; }
.tour-diagram { margin: .5rem 0 0; max-width: 24rem; }
.tour-diagram-title { font-size: 13px; font-weight: 650; }
.tour-diagram-view { display: block; width: 100%; height: auto; }
.tour-diagram-captions { margin: .25rem 0 0; }
.diagram-caption-1, .diagram-caption-2 { display: none; }
.diagram-globe { fill: #141c21; stroke: #5b7f8c; stroke-width: 2; stroke-dasharray: 7 6; }
.diagram-land { fill: #bdd6a6; } .diagram-underside { fill: #6b5a46; } .diagram-tree { fill: #6f9a5c; }
.diagram-glue { stroke: #7fb2e5; stroke-width: 2; } .diagram-decision { fill: #7fb2e5; }
.diagram-link { stroke: #7fb2e5; stroke-width: 1.2; opacity: .55; }
.diagram-tunnel { fill: none; stroke: #7fb2e5; stroke-width: 1; stroke-dasharray: 3 5; opacity: .5; }
.diagram-core { fill: url(#tour-diagram-core); } .diagram-loose { fill: #a5c5d1; opacity: .6; }
`;

/** Pixels between a card and its point, and kept clear at the window's edges. */
const GAP = 12;

/** The card's depth: what, why, how and its decisions, and for a decision the drawing of where it is kept, still at its last beat. */
function depth(card: Card): string {
  const decisions = card.decisions.map(decision => `<li>Decision ${decision.number}: ${escape(decision.title)}</li>`).join("");
  return `<h4>What</h4><p>${escape(card.what)}</p><h4>Why</h4><p>${escape(card.why)}</p><h4>How</h4><p>${escape(card.how)}</p>`
    + (card.kind === "decision" ? decisionsDiagram() : "")
    + (decisions === "" ? "" : `<h4>The decisions behind it</h4><ul>${decisions}</ul>`);
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Adopt the styles as a constructed sheet, which the app's style-src 'self' allows where a style element is refused. */
function adoptStyles(document: Document): () => void {
  const sheet = new (document.defaultView ?? window).CSSStyleSheet();
  sheet.replaceSync(STYLES);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(candidate => candidate !== sheet); };
}

/**
 * Show each kind's card in `host` the first time `take` hears it on the map, placed at `locate`'s point
 * for its target (the corner when it is not on show); cards fired together wait their turn.
 */
export function mountTeaching(host: HTMLElement, { journal, locate }: { journal: Journal; locate: Locate }): { take(reading: MapReading): void; stop(): void } {
  const unstyle = adoptStyles(host.ownerDocument);
  const waiting: Encounter[] = [];
  let shown: { card: HTMLElement; found: Encounter } | undefined;

  const place = (): void => {
    if (shown === undefined) return;
    const at = locate(shown.found.target);
    const onShow = at !== undefined && at.visible;
    shown.card.classList.toggle("teaching-card-corner", !onShow);
    if (!onShow) return;
    // Beside its point, on the right unless the window has no room there, and always inside the window.
    const { width, height } = shown.card.getBoundingClientRect();
    const view = host.ownerDocument.defaultView;
    const right = view?.innerWidth ?? Infinity, bottom = view?.innerHeight ?? Infinity;
    const left = at.x + GAP + width + GAP <= right ? at.x + GAP : at.x - GAP - width;
    shown.card.style.left = `${Math.max(GAP, Math.min(left, right - width - GAP))}px`;
    shown.card.style.top = `${Math.max(GAP, Math.min(at.y - height / 2, bottom - height - GAP))}px`;
  };
  const next = (): void => {
    const found = waiting.shift();
    if (found === undefined) return;
    const card = cardOf(found.kind);
    const node = host.ownerDocument.createElement("aside");
    node.className = "teaching-card";
    node.dataset.kind = found.kind;
    // A status, not a dialog: it is read out without moving focus or holding the page.
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.innerHTML = `<h3>${escape(card.title)}</h3><p>${escape(card.line)}</p><div data-depth hidden>${depth(card)}</div>
      <div class="teaching-card-actions"><button type="button" data-more aria-expanded="false">More</button><button type="button" data-dismiss>Got it</button></div>`;
    const more = node.querySelector<HTMLButtonElement>("[data-more]")!;
    more.addEventListener("click", () => {
      const open = node.querySelector<HTMLElement>("[data-depth]")!.hidden;
      node.querySelector<HTMLElement>("[data-depth]")!.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open ? "Less" : "More";
      // Taller now, so placed again to stay inside the window.
      place();
    });
    node.querySelector("[data-dismiss]")!.addEventListener("click", () => {
      node.remove();
      shown = undefined;
      next();
    });
    host.append(node);
    shown = { card: node, found };
    // Seen once shown: a card still waiting when the app closes shows next time.
    journal.mark(found.kind);
    place();
  };
  return {
    take(reading) {
      const queued = (kind: Kind) => shown?.found.kind === kind || waiting.some(one => one.kind === kind);
      waiting.push(...journal.unseen(encounters(reading)).filter(one => !queued(one.kind)));
      if (shown === undefined) next();
      else place();
    },
    stop() {
      shown?.card.remove();
      shown = undefined;
      waiting.length = 0;
      unstyle();
    },
  };
}

/** The journal of cards seen, in `host` (Help's page for it): each listed in order, chosen to show again with its depth. */
export function mountJournal(host: HTMLElement, { journal }: { journal: Journal }): { open(): void; close(): void; stop(): void } {
  const unstyle = adoptStyles(host.ownerDocument);
  const shelf = host.ownerDocument.createElement("section");
  shelf.className = "teaching-journal";
  host.append(shelf);
  const show = (kind: Kind): void => {
    const card = cardOf(kind);
    const box = shelf.querySelector<HTMLElement>("[data-journal-card]")!;
    box.dataset.kind = kind;
    box.hidden = false;
    box.innerHTML = `<h4>${escape(card.title)}</h4><p>${escape(card.line)}</p>${depth(card)}`;
  };
  return {
    open() {
      const seen = journal.seen();
      shelf.innerHTML = `<h3>What you've learned</h3>`
        + (seen.length === 0 ? "<p>Cards appear here as you meet each part of storytree on your map.</p>"
          : `<ol>${seen.map(one => `<li><button type="button" data-journal-entry="${one.kind}">${escape(cardOf(one.kind).title)}</button></li>`).join("")}</ol>`)
        + `<div data-journal-card hidden></div>`;
      for (const entry of shelf.querySelectorAll<HTMLButtonElement>("[data-journal-entry]")) {
        entry.addEventListener("click", () => show(entry.dataset.journalEntry as Kind));
      }
    },
    close() { shelf.replaceChildren(); },
    stop() { shelf.remove(); unstyle(); },
  };
}
