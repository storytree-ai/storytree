import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import { journal } from "../journal.js";
import { mountJournal, mountTeaching } from "./index.js";

function page() {
  const dom = new Window();
  const document = dom.document as unknown as Document;
  const host = document.createElement("div");
  document.body.append(host);
  const kept = new Map<string, string>();
  const store = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
  return { document, host, store };
}

const oneStory = { tree: { stories: [{ id: "story_a", capabilities: [] }], arcs: [] }, changes: [], lines: [] };

test("3.1 · a fired card shows beside its thing, takes no focus and blocks nothing; More opens its depth and Got it takes it away", () => {
  const { document, host, store } = page();
  const button = document.createElement("button");
  document.body.append(button);
  button.focus();
  const asked: unknown[] = [];
  const teaching = mountTeaching(host, { journal: journal(store), locate: (target) => { asked.push(target); return { x: 120, y: 80, visible: true }; } });
  teaching.take(oneStory);
  const card = host.querySelector<HTMLElement>(".teaching-card")!;
  assert.ok(card, "the story's card shows");
  assert.equal(card.dataset.kind, "story");
  assert.deepEqual(asked.at(-1), { kind: "story", story: "story_a" });
  assert.equal(card.style.left, "132px", "just right of its point");
  assert.equal(card.style.top, "80px");
  assert.equal(card.getAttribute("role"), "status", "announced politely, not a dialog");
  assert.equal(card.getAttribute("aria-modal"), null);
  assert.equal(document.activeElement, button, "focus stays where the user had it");
  const depth = card.querySelector<HTMLElement>("[data-depth]")!;
  assert.equal(depth.hidden, true);
  card.querySelector<HTMLButtonElement>("[data-more]")!.click();
  assert.equal(depth.hidden, false);
  assert.match(depth.textContent ?? "", /Why/);
  assert.match(depth.textContent ?? "", /Decision 819: A package for each story/, "More names the decisions behind it");
  card.querySelector<HTMLButtonElement>("[data-dismiss]")!.click();
  assert.equal(host.querySelector(".teaching-card"), null);
  // Seen once, it does not come back for the same reading.
  teaching.take(oneStory);
  assert.equal(host.querySelector(".teaching-card"), null);
  teaching.stop();
});

test("3.1 · a card at the window's right edge sits to the left of its point, inside the window", () => {
  const { document, host, store } = page();
  const view = document.defaultView as unknown as { innerWidth: number; innerHeight: number };
  view.innerWidth = 1000; view.innerHeight = 600;
  const teaching = mountTeaching(host, { journal: journal(store), locate: () => ({ x: 990, y: 590, visible: true }) });
  teaching.take(oneStory);
  const card = host.querySelector<HTMLElement>(".teaching-card")!;
  card.getBoundingClientRect = () => ({ width: 300, height: 100 }) as DOMRect;
  teaching.take(oneStory);
  assert.equal(card.style.left, "678px", "its right edge 12px left of the point");
  assert.equal(card.style.top, "488px", "its bottom 12px above the window's");
  teaching.stop();
});

test("3.1 · a target off screen puts its card in the corner, and the next card waits for the one on show", () => {
  const { host, store } = page();
  const kept = journal(store);
  const teaching = mountTeaching(host, { journal: kept, locate: () => undefined });
  teaching.take({ tree: { stories: [{ id: "story_a", capabilities: [{ id: "cap_a", proposed: true }] }], arcs: [] }, changes: [], lines: [] });
  const card = host.querySelector<HTMLElement>(".teaching-card")!;
  assert.equal(card.dataset.kind, "story");
  assert.ok(card.classList.contains("teaching-card-corner"));
  assert.equal(host.querySelectorAll(".teaching-card").length, 1);
  // The card still waiting is not yet seen, and the same reading again does not queue it twice.
  assert.deepEqual(kept.seen().map(one => one.kind), ["story"]);
  teaching.take({ tree: { stories: [{ id: "story_a", capabilities: [{ id: "cap_a", proposed: true }] }], arcs: [] }, changes: [], lines: [] });
  card.querySelector<HTMLButtonElement>("[data-dismiss]")!.click();
  assert.equal(host.querySelector<HTMLElement>(".teaching-card")!.dataset.kind, "capability");
  host.querySelector<HTMLButtonElement>(".teaching-card [data-dismiss]")!.click();
  assert.equal(host.querySelector(".teaching-card"), null, "each card shows once");
  teaching.stop();
  assert.equal(host.querySelector(".teaching-card"), null);
});

test("3.2 · the journal lists every card seen, in order, and choosing one shows it again with its depth", () => {
  const { host, store } = page();
  const kept = journal(store);
  kept.mark("empty"); kept.mark("story");
  const shelf = mountJournal(host, { journal: kept });
  shelf.open();
  const entries = [...host.querySelectorAll<HTMLButtonElement>("[data-journal-entry]")];
  assert.deepEqual(entries.map(entry => entry.dataset.journalEntry), ["empty", "story"]);
  entries[1]!.click();
  const shown = host.querySelector<HTMLElement>("[data-journal-card]")!;
  assert.equal(shown.dataset.kind, "story");
  assert.match(shown.textContent ?? "", /Why/);
  // Cards seen since it was last opened are listed when it opens again.
  kept.mark("arc");
  shelf.close(); shelf.open();
  assert.equal(host.querySelectorAll("[data-journal-entry]").length, 3);
  shelf.stop();
  assert.equal(host.children.length, 0);
});

test("3.3 · the decision card's depth draws a decision glued beneath its island and the ones it stands on deeper, toward the core; other cards draw nothing", () => {
  const { host, store } = page();
  const kept = journal(store);
  kept.mark("story"); kept.mark("decision");
  const shelf = mountJournal(host, { journal: kept });
  shelf.open();
  const show = (kind: string) => {
    host.querySelector<HTMLButtonElement>(`[data-journal-entry="${kind}"]`)!.click();
    return host.querySelector<HTMLElement>("[data-journal-card]")!;
  };
  assert.equal(show("story").querySelector("svg"), null);
  const drawing = show("decision").querySelector("svg")!;
  assert.ok(drawing, "the decision's depth has the drawing");
  assert.equal(drawing.closest("[data-journal-card]")!.querySelector("[style]"), null, "still, with no style attribute for the app's style-src 'self' to refuse");
  const at = (circle: Element) => ({ x: Number(circle.getAttribute("cx")), y: Number(circle.getAttribute("cy")) });
  const [cover, ...deeper] = [...drawing.querySelectorAll(".diagram-decision")].map(at);
  const core = drawing.querySelector(".diagram-core")!;
  const coreTop = Number(core.getAttribute("cy")) - Number(core.getAttribute("r")) / 2;
  assert.ok(deeper.length >= 3);
  assert.ok(deeper.every(decision => decision.y > cover!.y), "the cover hangs nearest the island");
  assert.ok([cover!, ...deeper].every(decision => decision.y < coreTop), "every decision hangs above the core it tunnels to");
  shelf.stop();
});
