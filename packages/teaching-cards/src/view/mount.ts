/**
 * Capability 3 · Cards and journal on screen. The cards are a tour the user is offered, never imposed: until they say yes
 * to it, only the ask shows, in a corner. A fired card shows beside the thing it explains, clear of its island and as clear
 * of the other islands as it can be, and tied to it by a ring and a line wherever it sits, one at a time, and never takes focus
 * or blocks the map; any card ends the tour. Between cards, while kinds are still to come, a quiet line in a corner says the
 * tour is on. The journal lists the cards seen and shows one again.
 */
import { cardOf, KINDS, type Card, type Kind } from "../cards.js";
import { encounters, type Encounter, type MapReading, type Target } from "../encounters.js";
import type { Journal } from "../journal.js";
import { decisionsDiagram } from "./diagram.js";

/** Where a target is on the page, in client pixels, with its island's box when it is on one, or undefined when it is not drawn. */
export type Locate = (target: Target) => { x: number; y: number; visible: boolean; box?: Box | undefined } | undefined;

/** A rectangle on the page, in client pixels. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** What the user is reading near a target (an open panel, the target's own name), in client pixels: a card covers none of it. */
export type Reading = (target: Target) => readonly Box[];

/** The boxes of the islands drawn on the page, in client pixels: a card covers as little of them as its place allows. */
export type Islands = () => readonly Box[];

const STYLES = `
.teaching-card { position: fixed; z-index: 20; max-width: 22rem; padding: .75rem .9rem; border-radius: .6rem;
  background: rgba(20, 24, 32, .94); color: #f2f4f8; font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35);
  box-sizing: border-box; max-height: min(24rem, calc(100vh - 24px)); overflow-y: auto; }
/* Beneath an open menu, dialog or overlay surface (the app's gear menu is a popover, the first launch's sharing consent an overlay):
   hidden, so none of it shows past the overlay's edge, and back when it closes. */
:root:has(:popover-open, dialog:modal, [data-surface-layer="overlay"]:not([hidden])) .teaching-card { display: none; }
/* A card's tie to its thing: a ring round it and a line from the card's nearest edge to the ring, both fixed to the window and
   inside the card, so they hide with it; neither takes a click. */
.teaching-card-ring, .teaching-card-tie { position: fixed; pointer-events: none; }
.teaching-card-ring { border: 2px solid rgba(242, 244, 248, .75); border-radius: 14px; box-sizing: border-box; }
.teaching-card-ring[data-point] { border-radius: 50%; }
.teaching-card-tie { height: 2px; margin-top: -1px; background: rgba(242, 244, 248, .75); transform-origin: 0 50%; }
.teaching-card h3 { margin: 0 0 .25rem; font-size: 15px; }
.teaching-card p, .teaching-journal p { margin: .25rem 0; }
.teaching-card [data-depth] h4, .teaching-journal h4 { margin: .5rem 0 0; font-size: 13px; }
.teaching-card-actions { display: flex; gap: .5rem; margin-top: .5rem; }
/* A card with depth scrolls only its text: Next and End tour stay below it, on show however tall More makes the card. With More
   open the card stays at most 24rem tall, short enough to find a place clear of the islands, and while more of its text lies
   below than it shows, the text's foot fades. */
.teaching-card:has(> .teaching-card-text) { display: flex; flex-direction: column; overflow: hidden; }
.teaching-card-text { min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(242, 244, 248, .45) transparent; }
.teaching-card-text[data-more-below] { mask-image: linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent); }
/* The decision card's drawing is taller than a 24rem card's text can show whole, so a card drawing one takes the window's height. */
.teaching-card:has([data-depth]:not([hidden]) .tour-diagram) { max-height: calc(100vh - 24px); }
.teaching-card-text + .teaching-card-actions { flex: none; }
.teaching-card [data-more] { padding: 0; border: 0; background: none; color: #9cc3e8; font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; }
.teaching-card[data-kind="on"] { padding: .4rem .7rem; background: rgba(20, 24, 32, .8); color: #c4cad4; font-size: 13px; }
.teaching-card[data-kind="on"] p { display: inline; margin: 0 .5rem 0 0; }
.teaching-card[data-kind="on"] button { font-size: 12px; }
.teaching-journal ol { padding-left: 1.25rem; }
.tour-diagram { margin: .5rem 0 0; max-width: 24rem; }
.tour-diagram-title { font-size: 13px; font-weight: 650; }
.tour-diagram-view { display: block; width: 100%; height: auto; }
.tour-diagram-captions { margin: .25rem 0 0; }
.diagram-caption { display: block; }
.diagram-globe { fill: #141c21; stroke: #5b7f8c; stroke-width: 2; stroke-dasharray: 7 6; }
.diagram-land { fill: #bdd6a6; } .diagram-underside { fill: #6b5a46; } .diagram-tree { fill: #6f9a5c; }
.diagram-glue { stroke: #7fb2e5; stroke-width: 2; } .diagram-decision { fill: #7fb2e5; } .diagram-cover { fill: #f2d27a; }
.diagram-link { stroke: #7fb2e5; stroke-width: 1.2; opacity: .55; }
.diagram-tunnel { fill: none; stroke: #7fb2e5; stroke-width: 1; stroke-dasharray: 3 5; opacity: .5; }
.diagram-core { fill: url(#tour-diagram-core); } .diagram-loose { fill: #e4e8ee; opacity: .75; }
`;

/** Pixels between a card and its point, and kept clear at the window's edges. */
const GAP = 12;
/** Pixels the ring round a card's island stands off it, and the radius of the ring at a point with no island. */
const RING = 6, DOT = 8;
/** Pixels between a card in a corner and the window's edges. */
const CORNER = 16;

/** The kinds only a factory's map holds, and the empty map's, which never comes again once a product's map holds anything. */
const FACTORY_ONLY: readonly Kind[] = ["factory", "role", "note", "check"];

/** How much of `boxes` a card at `card` covers, in square pixels. */
function covered(card: Box, boxes: readonly Box[]): number {
  return boxes.reduce((sum, box) => sum + Math.max(0, Math.min(card.right, box.right) - Math.max(card.left, box.left))
    * Math.max(0, Math.min(card.bottom, box.bottom) - Math.max(card.top, box.top)), 0);
}

/** Where `from` and `to` come nearest along one axis: the middle of where they overlap, else their facing edges. */
function facing(from: [number, number], to: [number, number]): [number, number] {
  const low = Math.max(from[0], to[0]), high = Math.min(from[1], to[1]);
  return low <= high ? [(low + high) / 2, (low + high) / 2] : from[1] < to[0] ? [from[1], to[0]] : [from[0], to[1]];
}

/**
 * Tie `card`, placed at `at`, to its thing: a ring round `box` (its island's), or a small round ring at `point` when it has none,
 * and a line from the card's nearest edge to the ring.
 */
function tie(card: HTMLElement, at: Box, point: { x: number; y: number }, box: Box | undefined): void {
  const document = card.ownerDocument;
  const ring = document.createElement("div");
  ring.className = "teaching-card-ring";
  ring.setAttribute("aria-hidden", "true");
  const around = box === undefined ? { left: point.x - DOT, top: point.y - DOT, right: point.x + DOT, bottom: point.y + DOT }
    : { left: box.left - RING, top: box.top - RING, right: box.right + RING, bottom: box.bottom + RING };
  if (box === undefined) ring.dataset.point = "";
  Object.assign(ring.style, { left: `${around.left}px`, top: `${around.top}px`, width: `${around.right - around.left}px`, height: `${around.bottom - around.top}px` });
  let from: [number, number], to: [number, number];
  if (box === undefined) {
    // From the card's point nearest the thing's, to the round ring's edge on the way.
    from = [Math.max(at.left, Math.min(point.x, at.right)), Math.max(at.top, Math.min(point.y, at.bottom))];
    const reach = Math.hypot(from[0] - point.x, from[1] - point.y);
    // A card edge already inside the ring draws no line.
    const scale = DOT / Math.max(reach, DOT);
    to = [point.x + (from[0] - point.x) * scale, point.y + (from[1] - point.y) * scale];
  } else {
    const [x0, x1] = facing([at.left, at.right], [around.left, around.right]), [y0, y1] = facing([at.top, at.bottom], [around.top, around.bottom]);
    from = [x0, y0]; to = [x1, y1];
  }
  const line = document.createElement("div");
  line.className = "teaching-card-tie";
  line.setAttribute("aria-hidden", "true");
  Object.assign(line.style, { left: `${from[0]}px`, top: `${from[1]}px`, width: `${Math.hypot(to[0] - from[0], to[1] - from[1])}px`,
    transform: `rotate(${Math.atan2(to[1] - from[1], to[0] - from[0])}rad)` });
  card.append(ring, line);
}

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
 * Show each kind's card in `host` the first time `take` hears it on the map, once the user has said yes to the tour (asked
 * first, in a corner), placed beside `locate`'s point and island for its target (a corner when it is not on show) where it
 * covers nothing `reading` names, and of the place clear of those, the one that covers least of `islands`; cards fired
 * together wait their turn, and one whose thing has gone or is done never shows.
 */
export function mountTeaching(host: HTMLElement, { journal, locate, reading = () => [], islands = () => [] }: { journal: Journal; locate: Locate; reading?: Reading; islands?: Islands }): { take(reading: MapReading): void; stop(): void } {
  const unstyle = adoptStyles(host.ownerDocument);
  const waiting: Encounter[] = [];
  /** The card on show, the tour's ask, or its line saying it is on between cards. */
  let shown: { card: HTMLElement; kind: Kind | "tour" | "on"; target: Target } | undefined;
  /** The map's last reading, to start the tour on at once when the user says yes. */
  let last: MapReading | undefined;

  const place = (): void => {
    if (shown === undefined) return;
    // The ask and the line between cards are about no one thing: they keep to a corner.
    const at = shown.kind === "tour" || shown.kind === "on" ? undefined : locate(shown.target);
    const onShow = at !== undefined && at.visible;
    shown.card.classList.toggle("teaching-card-corner", !onShow);
    const { width, height } = shown.card.getBoundingClientRect();
    const view = host.ownerDocument.defaultView;
    const right = view?.innerWidth ?? Infinity, bottom = view?.innerHeight ?? Infinity;
    // Always inside the window.
    const inside = (left: number, top: number): Box => {
      const x = Math.max(GAP, Math.min(left, right - width - GAP)), y = Math.max(GAP, Math.min(top, bottom - height - GAP));
      return { left: x, top: y, right: x + width, bottom: y + height };
    };
    const corners = [inside(right - width - CORNER, bottom - height - CORNER), inside(CORNER, bottom - height - CORNER),
      inside(right - width - CORNER, CORNER), inside(CORNER, CORNER)];
    // Beside its point, outside its island when it is on one: on the right unless the window has no room there, then the
    // other side, below, above; then the same sides slid to either end of the island's edge; then below what is read under
    // its point; and the corners.
    const around = onShow ? at.box ?? { left: at.x, top: at.y, right: at.x, bottom: at.y } : undefined;
    const read = reading(shown.target);
    const sides = around === undefined ? []
      : around.right + GAP + width + GAP <= right ? [around.right + GAP, around.left - GAP - width] : [around.left - GAP - width, around.right + GAP];
    const besides = !onShow || around === undefined ? []
      : [...sides.map(left => inside(left, at.y - height / 2)), inside(at.x - width / 2, around.bottom + GAP), inside(at.x - width / 2, around.top - GAP - height),
        ...sides.flatMap(left => [inside(left, around.top), inside(left, around.bottom - height)]),
        ...[around.bottom + GAP, around.top - GAP - height].flatMap(top => [inside(around.left, top), inside(around.right - width, top)]),
        // Then below its point, under each thing read there (a list beneath its tab), deepest last.
        ...read.filter(box => box.left <= at.x && at.x <= box.right && box.bottom > at.y).sort((one, two) => one.bottom - two.bottom)
          .map(box => inside(at.x - width / 2, box.bottom + GAP))];
    // Never over its own point or island, nor over what is being read; of the places clear of those, the one that covers
    // least of the drawn islands, the first on a tie; when every place covers some, the one that covers least of them.
    const clear = [...read, ...(onShow ? [{ left: at.x - GAP, top: at.y - GAP, right: at.x + GAP, bottom: at.y + GAP }, ...(at.box === undefined ? [] : [at.box])] : [])];
    const drawn = islands();
    const cost = (one: Box): [number, number] => [covered(one, clear), covered(one, drawn)];
    const chosen = [...besides, ...corners].map(one => ({ one, cost: cost(one) }))
      .reduce((best, next) => next.cost[0] < best.cost[0] || (next.cost[0] === best.cost[0] && next.cost[1] < best.cost[1]) ? next : best).one;
    shown.card.style.left = `${chosen.left}px`;
    shown.card.style.top = `${chosen.top}px`;
    // Wherever it sits, a corner included, a card whose thing is on show is tied to it, so which thing it explains is plain.
    for (const old of shown.card.querySelectorAll(".teaching-card-ring, .teaching-card-tie")) old.remove();
    if (onShow) tie(shown.card, chosen, at, at.box);
  };
  // A panel opened or closed on the page changes what is being read, so the card on show is placed again.
  const opened = new (host.ownerDocument.defaultView ?? window).MutationObserver(place);
  opened.observe(host, { subtree: true, attributeFilter: ["hidden"] });
  host.ownerDocument.defaultView?.addEventListener("resize", place);
  /** A card element, a status rather than a dialog: it is read out without moving focus or holding the page. */
  const aside = (kind: string, html: string): HTMLElement => {
    const node = host.ownerDocument.createElement("aside");
    node.className = "teaching-card";
    node.dataset.kind = kind;
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.innerHTML = html;
    return node;
  };
  const hide = (): void => {
    shown?.card.remove();
    shown = undefined;
  };
  const ask = (): void => {
    const node = aside("tour", `<h3>Want a quick tour?</h3><p>Short cards can explain each part of your map the first time it appears. You can start it later from Help.</p>
      <div class="teaching-card-actions"><button type="button" data-tour="yes">Show me</button><button type="button" data-tour="no">No thanks</button></div>`);
    for (const button of node.querySelectorAll<HTMLButtonElement>("[data-tour]")) button.addEventListener("click", () => journal.answer(button.dataset.tour === "yes" ? "yes" : "no"));
    host.append(node);
    shown = { card: node, kind: "tour", target: { kind: "map" } };
    place();
  };
  /** Between cards, with a kind still to come on this map: one quiet line that the tour is on, and what brings the next card. */
  const on = (): void => {
    const seen = journal.seen();
    const coming = KINDS.find(kind => kind !== "empty" && (last?.factory === true || !FACTORY_ONLY.includes(kind)) && !seen.some(was => was.kind === kind));
    if (coming === undefined) return;
    const node = aside("on", `<p>Tour on: the next card comes when ${escape(cardOf(coming).comes)}.</p><button type="button" data-end>End tour</button>`);
    node.querySelector("[data-end]")!.addEventListener("click", () => journal.answer("no"));
    host.append(node);
    shown = { card: node, kind: "on", target: { kind: "map" } };
    place();
  };
  const next = (): void => {
    const found = waiting.shift();
    if (found === undefined) { on(); return; }
    const card = cardOf(found.kind, { library: last?.library });
    const node = aside(found.kind, `<div class="teaching-card-text"><h3>${escape(card.title)}</h3><p>${escape(card.line)}</p>
      <button type="button" data-more aria-expanded="false">More</button><div data-depth hidden>${depth(card)}</div></div>
      <div class="teaching-card-actions"><button type="button" data-dismiss>Next</button><button type="button" data-end>End tour</button></div>`);
    const more = node.querySelector<HTMLButtonElement>("[data-more]")!;
    const deep = node.querySelector<HTMLElement>("[data-depth]")!, text = node.querySelector<HTMLElement>(".teaching-card-text")!;
    // While more of the text lies below than it shows, its foot fades, so a line cut at its edge reads as one that goes on.
    const below = (): void => { text.toggleAttribute("data-more-below", text.scrollHeight - text.scrollTop - text.clientHeight > 1); };
    text.addEventListener("scroll", below);
    more.addEventListener("click", () => {
      const open = deep.hidden;
      deep.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open ? "Less" : "More";
      // Taller now, so placed again to stay inside the window.
      place();
      below();
    });
    node.querySelector("[data-dismiss]")!.addEventListener("click", () => {
      hide();
      next();
    });
    node.querySelector("[data-end]")!.addEventListener("click", () => journal.answer("no"));
    host.append(node);
    shown = { card: node, kind: found.kind, target: found.target };
    // Seen once shown: a card still waiting when the app closes shows next time.
    journal.mark(found.kind);
    place();
  };
  const take = (reading: MapReading): void => {
    last = reading;
    const found = encounters(reading);
    // A card still waiting whose thing has gone from the map, or is done (the plan once it is finished), never shows.
    waiting.splice(0, waiting.length, ...waiting.filter(one => found.some(now => now.kind === one.kind)));
    // The empty-map tip on show is wrong once the map holds an island (an import's included).
    if (shown?.kind === "empty" && !found.some(one => one.kind === "empty") && !reading.factory) hide();
    const tour = journal.tour();
    if (tour === "no") return;
    const queued = (kind: Kind) => shown?.kind === kind || waiting.some(one => one.kind === kind);
    waiting.push(...journal.unseen(found).filter(one => !queued(one.kind)));
    // A card come to the map takes the place of the line saying the tour is on.
    if (shown?.kind === "on" && waiting.length > 0) hide();
    if (shown !== undefined) place();
    else if (tour === "yes") next();
    else if (waiting.length > 0) ask();
  };
  // An answer given on the ask, on a card's End tour or in Help: a yes starts the tour on the map on show, a no clears it.
  const unlisten = journal.listen(tour => {
    if (tour === "no") { hide(); waiting.length = 0; return; }
    if (shown?.kind === "tour") hide();
    if (shown === undefined && last !== undefined) take(last);
  });
  return {
    take,
    stop() {
      unlisten();
      opened.disconnect();
      host.ownerDocument.defaultView?.removeEventListener("resize", place);
      shown?.card.remove();
      shown = undefined;
      waiting.length = 0;
      unstyle();
    },
  };
}

/**
 * The journal of cards seen, in `host` (Help's page for it): each listed in order, chosen to show again with its depth, as true
 * of the map as `library` says it is now (whether the Library surface is on; on unless said).
 */
export function mountJournal(host: HTMLElement, { journal, library }: { journal: Journal; library?: () => boolean | undefined }): { open(): void; close(): void; stop(): void } {
  const unstyle = adoptStyles(host.ownerDocument);
  const shelf = host.ownerDocument.createElement("section");
  shelf.className = "teaching-journal";
  host.append(shelf);
  const show = (kind: Kind): void => {
    const card = cardOf(kind, { library: library?.() });
    const box = shelf.querySelector<HTMLElement>("[data-journal-card]")!;
    box.dataset.kind = kind;
    box.hidden = false;
    box.innerHTML = `<h4>${escape(card.title)}</h4><p>${escape(card.line)}</p>${depth(card)}`;
  };
  const open = (): void => {
    const seen = journal.seen();
    shelf.innerHTML = `<h3>What you've learned</h3>`
      + (seen.length === 0 ? "<p>Cards appear here as you meet each part of storytree on your map.</p>"
        : `<ol>${seen.map(one => `<li><button type="button" data-journal-entry="${one.kind}">${escape(cardOf(one.kind).title)}</button></li>`).join("")}</ol>`)
      // The tour, offered here to a user who has not taken it: a card explains each part of the map as it appears.
      + (journal.tour() === "yes" ? "" : `<p><button type="button" data-tour-start>Take the tour</button></p>`)
      + `<div data-journal-card hidden></div>`;
    for (const entry of shelf.querySelectorAll<HTMLButtonElement>("[data-journal-entry]")) {
      entry.addEventListener("click", () => show(entry.dataset.journalEntry as Kind));
    }
    shelf.querySelector("[data-tour-start]")?.addEventListener("click", () => { journal.answer("yes"); open(); });
  };
  return {
    open,
    close() { shelf.replaceChildren(); },
    stop() { shelf.remove(); unstyle(); },
  };
}
