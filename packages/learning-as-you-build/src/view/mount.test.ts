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
  assert.equal(card.style.left, "120px");
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

test("3.1 · a target off screen puts its card in the corner, and the next card waits for the one on show", () => {
  const { host, store } = page();
  const teaching = mountTeaching(host, { journal: journal(store), locate: () => undefined });
  teaching.take({ tree: { stories: [{ id: "story_a", capabilities: [{ id: "cap_a", proposed: true }] }], arcs: [] }, changes: [], lines: [] });
  const card = host.querySelector<HTMLElement>(".teaching-card")!;
  assert.equal(card.dataset.kind, "story");
  assert.ok(card.classList.contains("teaching-card-corner"));
  assert.equal(host.querySelectorAll(".teaching-card").length, 1);
  card.querySelector<HTMLButtonElement>("[data-dismiss]")!.click();
  assert.equal(host.querySelector<HTMLElement>(".teaching-card")!.dataset.kind, "capability");
  teaching.stop();
  assert.equal(host.querySelector(".teaching-card"), null);
});

test("3.2 · the journal lists every card seen, in order, and choosing one shows it again with its depth", () => {
  const { host, store } = page();
  const kept = journal(store);
  kept.fresh([{ kind: "empty", target: { kind: "map" } }, { kind: "story", target: { kind: "story", story: "story_a" } }]);
  const shelf = mountJournal(host, { journal: kept });
  shelf.open();
  const entries = [...host.querySelectorAll<HTMLButtonElement>("[data-journal-entry]")];
  assert.deepEqual(entries.map(entry => entry.dataset.journalEntry), ["empty", "story"]);
  entries[1]!.click();
  const shown = host.querySelector<HTMLElement>("[data-journal-card]")!;
  assert.equal(shown.dataset.kind, "story");
  assert.match(shown.textContent ?? "", /Why/);
  // Cards seen since it was last opened are listed when it opens again.
  kept.fresh([{ kind: "arc", target: { kind: "arc", arc: "arc_1" } }]);
  shelf.close(); shelf.open();
  assert.equal(host.querySelectorAll("[data-journal-entry]").length, 3);
  shelf.stop();
  assert.equal(host.children.length, 0);
});
