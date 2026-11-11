import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { waitUntil } from "@storytree/test-waits";

import { journal } from "../journal.js";
import { mountJournal, mountTeaching } from "./index.js";

/** A page whose user has said yes to the tour, unless they have not answered it yet. */
function page({ unanswered = false } = {}) {
  const dom = new Window();
  const document = dom.document as unknown as Document;
  const host = document.createElement("div");
  document.body.append(host);
  const kept = new Map<string, string>(unanswered ? [] : [["storytree.teaching.tour.v1", "yes"]]);
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
  assert.ok(document.activeElement === button, "focus stays where the user had it");
  const depth = card.querySelector<HTMLElement>("[data-depth]")!;
  assert.equal(depth.hidden, true);
  card.querySelector<HTMLButtonElement>("[data-more]")!.click();
  assert.equal(depth.hidden, false);
  assert.match(depth.textContent ?? "", /Why/);
  assert.match(depth.textContent ?? "", /Decision 819: A package for each story/, "More names the decisions behind it");
  card.querySelector<HTMLButtonElement>("[data-dismiss]")!.click();
  assert.ok(host.querySelector(".teaching-card") === null);
  // Seen once, it does not come back for the same reading.
  teaching.take(oneStory);
  assert.ok(host.querySelector(".teaching-card") === null);
  teaching.stop();
});

test("1.2 · a fired decision card on a map whose Library is switched off names no Library switch", () => {
  const { host, store } = page();
  const kept = journal(store);
  for (const kind of ["story"] as const) kept.mark(kind);
  const teaching = mountTeaching(host, { journal: kept, locate: () => undefined });
  const decided = { ...oneStory, changes: [{ type: "decision", recordId: "decision_1", action: "created", record: { fields: {} } }] };
  teaching.take({ ...decided, library: false });
  const card = host.querySelector<HTMLElement>(".teaching-card")!;
  assert.equal(card.dataset.kind, "decision");
  assert.doesNotMatch(card.textContent ?? "", /press Library/);
  assert.match(card.textContent ?? "", /Surfaces/);
  teaching.stop();
});

test("1.2 · a decision card reopened from Help's journal while the Library is switched off names no Library switch", () => {
  const { host, store } = page();
  const kept = journal(store);
  kept.mark("decision");
  let library = false;
  const shelf = mountJournal(host, { journal: kept, library: () => library });
  const reopened = () => {
    shelf.open();
    host.querySelector<HTMLButtonElement>('[data-journal-entry="decision"]')!.click();
    return host.querySelector<HTMLElement>("[data-journal-card]")!.textContent ?? "";
  };
  assert.doesNotMatch(reopened(), /press Library/);
  assert.match(reopened(), /Surfaces/);
  library = true;
  assert.match(reopened(), /press Library at the top of the map/, "read again each time it is shown");
  shelf.stop();
  // A journal told nothing of the Library shows it on.
  const told = mountJournal(host, { journal: kept });
  told.open();
  host.querySelector<HTMLButtonElement>('[data-journal-entry="decision"]')!.click();
  assert.match(host.querySelector("[data-journal-card]")!.textContent ?? "", /press Library at the top of the map/);
  told.stop();
  const unread = mountJournal(host, { journal: kept, library: () => undefined });
  unread.open();
  host.querySelector<HTMLButtonElement>('[data-journal-entry="decision"]')!.click();
  assert.match(host.querySelector("[data-journal-card]")!.textContent ?? "", /press Library at the top of the map/, "nor one whose reading is not in yet");
  unread.stop();
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
  assert.ok(host.querySelector(".teaching-card") === null, "each card shows once");
  teaching.stop();
  assert.ok(host.querySelector(".teaching-card") === null);
});

test("3.1 · End tour on any card takes it away with every card still waiting, and no card shows again", () => {
  const { host, store } = page();
  const kept = journal(store);
  const teaching = mountTeaching(host, { journal: kept, locate: () => undefined });
  const grown = { tree: { stories: [{ id: "story_a", capabilities: [{ id: "cap_a", proposed: true }] }], arcs: [] }, changes: [], lines: [] };
  teaching.take(grown);
  host.querySelector<HTMLButtonElement>(".teaching-card [data-end]")!.click();
  assert.ok(host.querySelector(".teaching-card") === null, "the capability's card waiting behind it never shows");
  assert.equal(kept.tour(), "no");
  teaching.take({ ...grown, tree: { ...grown.tree, arcs: [{ id: "arc_1" }] } });
  assert.ok(host.querySelector(".teaching-card") === null, "nor does a card for what appears later");
  teaching.stop();
});

test("3.7 · until the user says yes to the tour, only the ask shows, in a corner: No leaves the map clear for good, Yes shows the cards", () => {
  for (const answer of ["no", "yes"] as const) {
    const { host, store } = page({ unanswered: true });
    const kept = journal(store);
    const teaching = mountTeaching(host, { journal: kept, locate: () => ({ x: 120, y: 80, visible: true }) });
    teaching.take(oneStory);
    const ask = host.querySelector<HTMLElement>(".teaching-card")!;
    assert.equal(ask.dataset.kind, "tour", "the ask, not the story's card");
    assert.ok(ask.classList.contains("teaching-card-corner"), "in a corner, not beside the island");
    assert.equal(ask.getAttribute("role"), "status");
    assert.equal(host.querySelectorAll(".teaching-card").length, 1);
    // Ignored, the ask stays the only thing shown, and nothing is marked seen.
    teaching.take(oneStory);
    assert.equal(host.querySelectorAll(".teaching-card").length, 1);
    assert.deepEqual(kept.seen(), []);
    ask.querySelector<HTMLButtonElement>(`[data-tour="${answer}"]`)!.click();
    assert.equal(kept.tour(), answer);
    const shown = [...host.querySelectorAll<HTMLElement>(".teaching-card")].map(card => card.dataset.kind);
    assert.deepEqual(shown, answer === "yes" ? ["story"] : [], answer === "yes" ? "the story's card in its place" : "the map left clear");
    teaching.take({ tree: { stories: [{ id: "story_a", capabilities: [] }], arcs: [{ id: "arc_1" }] }, changes: [], lines: [] });
    if (answer === "no") assert.ok(host.querySelector(".teaching-card") === null, "and kept clear as the map grows");
    teaching.stop();
  }
});

test("3.7 · a yes given elsewhere (Help's journal) shows the first card for the map on show at once, with no new reading", () => {
  const { host, store } = page({ unanswered: true });
  const kept = journal(store);
  const teaching = mountTeaching(host, { journal: kept, locate: () => undefined });
  teaching.take(oneStory);
  host.querySelector<HTMLButtonElement>('[data-tour="no"]')!.click();
  kept.answer("yes");
  assert.equal(host.querySelector<HTMLElement>(".teaching-card")!.dataset.kind, "story");
  teaching.stop();
  kept.answer("no"); kept.answer("yes");
  assert.ok(host.querySelector(".teaching-card") === null, "a stopped mount hears no more");
});

test("3.2 · Help's journal offers the tour to a user who has not said yes, and taking it there says yes", () => {
  const { host, store } = page({ unanswered: true });
  const kept = journal(store);
  const shelf = mountJournal(host, { journal: kept });
  shelf.open();
  host.querySelector<HTMLButtonElement>("[data-tour-start]")!.click();
  assert.equal(kept.tour(), "yes");
  assert.ok(host.querySelector("[data-tour-start]") === null, "offered no more once taken");
  shelf.open();
  assert.ok(host.querySelector("[data-tour-start]") === null);
  shelf.stop();
});

test("3.8 · a card still waiting whose thing is gone from the map, or done, never shows: the plan's card once the plan is finished", () => {
  const { host, store } = page();
  const kept = journal(store);
  const teaching = mountTeaching(host, { journal: kept, locate: () => undefined });
  teaching.take(oneStory);
  const planned = (status: string) => ({ tree: { stories: [{ id: "story_a", capabilities: [] }], arcs: [{ id: "arc_1" }] }, lines: [],
    changes: [{ type: "increment", recordId: "increment_1", action: "created", record: { fields: { arc: "arc_1", status } } }] });
  // The plan's card waits behind the story's while the agent works the plan.
  teaching.take(planned("proposal"));
  teaching.take(planned("closed"));
  host.querySelector<HTMLButtonElement>(".teaching-card [data-dismiss]")!.click();
  assert.ok(host.querySelector(".teaching-card") === null, "no plan tip after the plan is done");
  assert.ok(!kept.seen().some(one => one.kind === "arc"), "never shown, so never marked seen");
  teaching.stop();
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
  assert.ok(show("story").querySelector("svg") === null);
  const drawing = show("decision").querySelector("svg")!;
  assert.ok(drawing, "the decision's depth has the drawing");
  assert.ok(drawing.closest("[data-journal-card]")!.querySelector("[style]") === null, "still, with no style attribute for the app's style-src 'self' to refuse");
  const at = (circle: Element) => ({ x: Number(circle.getAttribute("cx")), y: Number(circle.getAttribute("cy")) });
  const [cover, ...deeper] = [...drawing.querySelectorAll(".diagram-decision")].map(at);
  const core = drawing.querySelector(".diagram-core")!;
  const coreTop = Number(core.getAttribute("cy")) - Number(core.getAttribute("r")) / 2;
  assert.ok(deeper.length >= 3);
  assert.ok(deeper.every(decision => decision.y > cover!.y), "the cover hangs nearest the island");
  assert.ok([cover!, ...deeper].every(decision => decision.y < coreTop), "every decision hangs above the core it tunnels to");
  shelf.stop();
});

/** A 1000 × 600 window whose cards measure 300 × 100, the rectangles `reading` says are being read, and the drawn islands' boxes. */
function sized(reading: { left: number; top: number; right: number; bottom: number }[], locate: Parameters<typeof mountTeaching>[1]["locate"], islands: { left: number; top: number; right: number; bottom: number }[] = []) {
  const { document, host, store } = page();
  const view = document.defaultView as unknown as { innerWidth: number; innerHeight: number };
  view.innerWidth = 1000; view.innerHeight = 600;
  const element = document.defaultView!.HTMLElement.prototype as unknown as HTMLElement;
  const measured = element.getBoundingClientRect;
  element.getBoundingClientRect = function (this: HTMLElement) {
    return (this.classList.contains("teaching-card") ? { width: 300, height: 100 } : measured.call(this)) as DOMRect;
  };
  const asked: unknown[] = [];
  const teaching = mountTeaching(host, { journal: journal(store), locate, reading: (target) => { asked.push(target); return reading; }, islands: () => islands });
  teaching.take(oneStory);
  const card = host.querySelector<HTMLElement>(".teaching-card")!;
  return { document, host, teaching, card, asked, at: () => ({ left: card.style.left, top: card.style.top }) };
}

const panel = { left: 520, top: 12, right: 988, bottom: 588 };

test("3.5 · a card whose right side would cover the open panel sits on the left of its point instead", () => {
  const { teaching, at, asked } = sized([panel], () => ({ x: 400, y: 300, visible: true }));
  assert.deepEqual(asked.at(-1), { kind: "story", story: "story_a" }, "the page is asked what is being read near the card's thing");
  assert.deepEqual(at(), { left: "88px", top: "250px" });
  teaching.stop();
});

test("3.5 · a card whose thing is an island sits beside the island's box, never over the island", () => {
  const island = { left: 300, top: 250, right: 500, bottom: 350 };
  const { teaching, at } = sized([], () => ({ x: 400, y: 300, visible: true, box: island }));
  assert.deepEqual(at(), { left: "512px", top: "250px" }, "12px right of the island, not of its middle");
  teaching.stop();
});

test("3.5 · with no room right of its island, a card sits left of the island; with both sides read, below it; never over it", () => {
  const { teaching: beside, at: besideAt } = sized([], () => ({ x: 700, y: 300, visible: true, box: { left: 600, top: 250, right: 800, bottom: 350 } }));
  assert.deepEqual(besideAt(), { left: "288px", top: "250px" }, "12px left of the island's left edge");
  beside.stop();
  const island = { left: 300, top: 250, right: 500, bottom: 350 };
  const { teaching: under, at: underAt } = sized([{ left: 0, top: 200, right: 1000, bottom: 360 }], () => ({ x: 400, y: 300, visible: true, box: island }));
  assert.deepEqual(underAt(), { left: "250px", top: "362px" }, "12px below the island");
  under.stop();
  // Read right of the island, the left place pressed against the window's edge still overlaps the island, and below it the
  // middle is read: below it still, slid to end at the island's right edge.
  const { teaching: slid, at: slidAt } = sized([{ left: 505, top: 0, right: 1000, bottom: 600 }], () => ({ x: 400, y: 300, visible: true, box: island }));
  assert.deepEqual(slidAt(), { left: "200px", top: "362px" });
  slid.stop();
});

test("3.5 · a card with room right of its island only by pressing against it sits left of the island instead", () => {
  // 680 + 12 + 300 + 12 = 1004 > 1000: kept inside the window, the right place would sit 8px off the island, not 12.
  const { teaching, at } = sized([], () => ({ x: 580, y: 300, visible: true, box: { left: 480, top: 250, right: 680, bottom: 350 } }));
  assert.deepEqual(at(), { left: "168px", top: "250px" }, "12px left of the island");
  teaching.stop();
});

test("3.5 · in a window too narrow for either side, a card pushed back inside over its own point sits below it instead", () => {
  const { document, teaching, at } = sized([], () => ({ x: 200, y: 300, visible: true }));
  const view = document.defaultView as unknown as { innerWidth: number };
  view.innerWidth = 400;
  document.defaultView!.dispatchEvent(new (document.defaultView as unknown as typeof globalThis).Event("resize"));
  assert.deepEqual(at(), { left: "50px", top: "312px" }, "either side, kept inside the 400px window, would cover the point");
  teaching.stop();
});

test("3.5 · a card beside a nameplate it would cover on either side sits above its point", () => {
  const plate = { left: 340, top: 310, right: 460, bottom: 340 };
  const { teaching, at } = sized([plate], () => ({ x: 400, y: 300, visible: true }));
  assert.deepEqual(at(), { left: "250px", top: "188px" });
  teaching.stop();
});

test("3.5 · a card whose thing is off screen takes the corner clear of the open panel", () => {
  const { teaching, at, card } = sized([panel], () => undefined);
  assert.ok(card.classList.contains("teaching-card-corner"));
  assert.deepEqual(at(), { left: "16px", top: "484px" }, "the bottom left corner, the bottom right being under the panel");
  teaching.stop();
});

test("3.5 · a panel that opens after the card is shown moves the card off it", async () => {
  const reading: { left: number; top: number; right: number; bottom: number }[] = [];
  const { document, host, teaching, at } = sized(reading, () => ({ x: 400, y: 300, visible: true }));
  assert.deepEqual(at(), { left: "412px", top: "250px" }, "on the right while nothing is open");
  const aside = document.createElement("aside");
  aside.hidden = true;
  host.append(aside);
  reading.push(panel);
  aside.hidden = false;
  await waitUntil(() => at().left === "88px", 2000, "the card to move off the opened panel");
  assert.deepEqual(at(), { left: "88px", top: "250px" }, "on the left once the panel is open");
  teaching.stop();
});

test("3.5 · a window resized under the card places it again, clear of what is being read", () => {
  const reading: { left: number; top: number; right: number; bottom: number }[] = [];
  const { document, teaching, at } = sized(reading, () => ({ x: 400, y: 300, visible: true }));
  assert.deepEqual(at(), { left: "412px", top: "250px" });
  reading.push(panel);
  document.defaultView!.dispatchEvent(new (document.defaultView as unknown as typeof globalThis).Event("resize"));
  assert.deepEqual(at(), { left: "88px", top: "250px" });
  teaching.stop();
});

test("3.5 · when every place covers something being read, the card takes the place that covers least", () => {
  // The whole window is being read, and the right of the point twice over.
  const { teaching, at } = sized([{ left: 0, top: 0, right: 1000, bottom: 600 }, { left: 412, top: 250, right: 712, bottom: 350 }], () => ({ x: 400, y: 300, visible: true }));
  assert.deepEqual(at(), { left: "88px", top: "250px" }, "the left of its point, not the right it would take first");
  teaching.stop();
});

/** A tall island in the middle of the window, and a neighbour over each of the four places beside it. */
const tall = { left: 400, top: 200, right: 600, bottom: 400 };
const neighbours = [{ left: 650, top: 150, right: 900, bottom: 290 }, { left: 100, top: 260, right: 300, bottom: 340 },
  { left: 450, top: 420, right: 550, bottom: 500 }, { left: 450, top: 100, right: 550, bottom: 180 }];

test("3.5 · a card beside its island that would cover a neighbouring island slides along its island's side clear of it", () => {
  const { teaching, at } = sized([], () => ({ x: 500, y: 300, visible: true, box: tall }), [tall, ...neighbours]);
  assert.deepEqual(at(), { left: "612px", top: "300px" }, "right of the island, its bottom at the island's bottom, under the neighbour on the right");
  teaching.stop();
});

test("3.5 · a card whose point is a tab above a list being read sits under the list, below its point, before any corner", () => {
  const tabs = { left: 0, top: 48, right: 432, bottom: 88 }, list = { left: 0, top: 88, right: 432, bottom: 160 };
  const { teaching, at } = sized([tabs, list], () => ({ x: 135, y: 67, visible: true }));
  assert.deepEqual(at(), { left: "12px", top: "172px" }, "12px under the list, as near its point as the window lets it");
  teaching.stop();
});

test("3.5 · a card that covers a neighbouring island wherever it sits beside its own takes a corner clear of every island", () => {
  const { teaching, at } = sized([], () => ({ x: 500, y: 300, visible: true }), [{ left: 150, top: 120, right: 850, bottom: 480 }]);
  assert.deepEqual(at(), { left: "684px", top: "484px" }, "the bottom-right corner, below the islands");
  teaching.stop();
});

test("3.5 · when every place covers an island, the card covers least of them, and never its own island to spare another", () => {
  const everywhere = { left: 0, top: 0, right: 1000, bottom: 600 };
  const { teaching, at } = sized([], () => ({ x: 500, y: 300, visible: true, box: tall }), [tall, everywhere, { left: 612, top: 250, right: 912, bottom: 350 }]);
  assert.deepEqual(at(), { left: "88px", top: "250px" }, "left of its island, not the right it would take first, which covers two");
  teaching.stop();
});

test("3.6 · the empty-map card on show is taken away once the map holds an island, and the island's cards show in its place", () => {
  const { host, store } = page();
  const teaching = mountTeaching(host, { journal: journal(store), locate: () => undefined });
  teaching.take({ tree: { stories: [], arcs: [] }, changes: [], lines: [] });
  assert.equal(host.querySelector<HTMLElement>(".teaching-card")!.dataset.kind, "empty");
  // An import draws its island with no click on Got it.
  teaching.take(oneStory);
  const cards = [...host.querySelectorAll<HTMLElement>(".teaching-card")];
  assert.deepEqual(cards.map(card => card.dataset.kind), ["story"]);
  teaching.stop();
});

test("3.6 · an empty-map card still waiting when the map gains an island never shows", () => {
  const { host, store } = page();
  const kept = journal(store);
  const teaching = mountTeaching(host, { journal: kept, locate: () => undefined });
  // The factory's card is on show while the user's own empty map queues its tip behind it.
  teaching.take({ tree: { stories: [], arcs: [] }, changes: [], lines: [], factory: true });
  teaching.take({ tree: { stories: [], arcs: [] }, changes: [], lines: [] });
  teaching.take(oneStory);
  assert.equal(host.querySelector<HTMLElement>(".teaching-card")!.dataset.kind, "factory");
  host.querySelector<HTMLButtonElement>(".teaching-card [data-dismiss]")!.click();
  assert.equal(host.querySelector<HTMLElement>(".teaching-card")!.dataset.kind, "story");
  assert.ok(!kept.seen().some(one => one.kind === "empty"), "never shown, so never marked seen");
  teaching.stop();
});

/** Where a tie's line starts and ends, read from its place, length and turn. */
function ends(line: HTMLElement): { from: [number, number]; to: [number, number] } {
  const x = parseFloat(line.style.left), y = parseFloat(line.style.top), length = parseFloat(line.style.width);
  const turn = parseFloat(/rotate\((-?[\d.e-]+)rad\)/.exec(line.style.transform)![1]!);
  return { from: [x, y], to: [x + length * Math.cos(turn), y + length * Math.sin(turn)] };
}

const near = (actual: [number, number], expected: [number, number], message: string) =>
  assert.ok(Math.abs(actual[0] - expected[0]) < 0.01 && Math.abs(actual[1] - expected[1]) < 0.01, `${message}: ${actual} is not ${expected}`);

test("3.10 · a card beside its island draws a ring round the island and a line from its nearest edge to the ring", () => {
  const island = { left: 300, top: 250, right: 500, bottom: 350 };
  const { teaching, card } = sized([], () => ({ x: 400, y: 300, visible: true, box: island }));
  // Right of the island: the card is at 512, 250, 300 × 100.
  const ring = card.querySelector<HTMLElement>(".teaching-card-ring")!;
  assert.ok(ring, "a ring round its island");
  assert.deepEqual([ring.style.left, ring.style.top, ring.style.width, ring.style.height], ["294px", "244px", "212px", "112px"], "round the island's box, just outside it");
  const line = card.querySelector<HTMLElement>(".teaching-card-tie")!;
  const { from, to } = ends(line);
  near(from, [512, 300], "the line leaves the card's edge facing the island");
  near(to, [506, 300], "and ends on the ring");
  teaching.stop();
});

test("3.10 · a card taken to a corner while its thing is on show is still tied to it; a ring marks a point with no island", () => {
  const { teaching, card } = sized([], () => ({ x: 500, y: 300, visible: true }), [{ left: 150, top: 120, right: 850, bottom: 480 }]);
  // The bottom-right corner, 684, 484.
  const ring = card.querySelector<HTMLElement>(".teaching-card-ring")!;
  assert.deepEqual([ring.style.left, ring.style.top, ring.style.width, ring.style.height], ["492px", "292px", "16px", "16px"], "a small ring at its point");
  const { from, to } = ends(card.querySelector<HTMLElement>(".teaching-card-tie")!);
  near(from, [684, 484], "from the card's corner nearest the point");
  near(to, [500 + 8 / Math.SQRT2, 300 + 8 / Math.SQRT2], "to the ring's edge, on the card's side of it");
  teaching.stop();
});

test("3.10 · a card whose thing is off screen, and the tour's ask, are tied to nothing", () => {
  const { teaching, card } = sized([], () => ({ x: 500, y: 300, visible: false }));
  assert.ok(card.querySelector(".teaching-card-ring") === null, "no ring for a thing off screen");
  assert.ok(card.querySelector(".teaching-card-tie") === null, "and no line");
  teaching.stop();
  const { host, store } = page({ unanswered: true });
  const asked = mountTeaching(host, { journal: journal(store), locate: () => ({ x: 120, y: 80, visible: true }) });
  asked.take(oneStory);
  const ask = host.querySelector<HTMLElement>(".teaching-card")!;
  assert.equal(ask.dataset.kind, "tour");
  assert.ok(ask.querySelector(".teaching-card-tie") === null, "the ask is tied to nothing");
  asked.stop();
});
