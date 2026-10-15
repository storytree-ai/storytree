/** Capability 4: the pinned artifact shows its summary and can be dismissed. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Children, isValidElement, type ReactNode } from "react";

import type { Change, SchemaRecord } from "@storytree/library";

import { knowledge } from "../ghosts/ghosts.js";
import { noteCard, type Card } from "../look-inside/look-inside.js";
import { History } from "../testing/changes.js";
import * as drawing from "./drawing.js";
import { createKnowledgeCore } from "./index.js";

test("4.1 the artifact card shows kind, title and summary without inspection metadata; Close dismisses it", () => {
  const card: Card = { id: "note", kind: "principle", title: "Protect a behaviour", summary: "Write the minimum test.", text: "The full detailed explanation." };
  let closed = false;
  const rendered = drawing.NoteCard({ card, onClose: () => { closed = true; } });
  const nodes = descendants(rendered);
  const words = nodes.filter((node): node is string => typeof node === "string").join(" ");
  assert.match(words, /principle/);
  assert.match(words, /Protect a behaviour/);
  assert.match(words, /Write the minimum test\./);
  assert.doesNotMatch(words, /full detailed|Links|Recorded|Depth|Entrances/);
  const close = nodes.find((node) => isValidElement(node) && node.type === "button");
  assert.ok(isValidElement<{ onClick: () => void; "aria-label": string }>(close));
  assert.match(close.props["aria-label"], /Close/);
  close.props.onClick();
  assert.equal(closed, true);

  const whole = drawing.NoteCard({ card: { ...card, summary: undefined }, onClose: () => {} });
  assert.ok(descendants(whole).includes(card.text), "without a summary the entire artifact text is shown");
});

test("4.6 one shared pin holds one card at a time for both globe modes: a new pin replaces it, closing clears it, and pinning asks the host for nothing", () => {
  const asked: string[] = [];
  const core = createKnowledgeCore("app", { reads: {
    windowReading: async (_project, session) => { asked.push(session); throw new Error("not read"); },
  } });
  const pinned = (): string | undefined => (core as unknown as { get(): { pinned: string | undefined } }).get().pinned;
  try {
    core.pin("principle");
    assert.equal(pinned(), "principle");
    core.pin("decision");
    assert.equal(pinned(), "decision");
    core.pin(undefined);
    assert.equal(pinned(), undefined);
    assert.deepEqual(asked, []);
  } finally {
    core.dispose();
  }
});

test("4.23 a product's globe draws the system notes it reads from its factory beside its own, and their card says they come from the factory; its own copy and what it retires are its own", async () => {
  const record = (id: string, title: string): SchemaRecord => ({
    id, type: "principle", version: 1, createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
    fields: { title, description: `${title}.`, statement: title, why: "It helps.", howToApply: "Do it." },
  } as SchemaRecord);
  let factory: SchemaRecord[] = [record("principle_inherited", "Keep it small"), record("principle_copied", "Test first")];
  const asked: string[] = [];
  const core = createKnowledgeCore("site", { reads: {
    windowReading: async () => { throw new Error("not read"); },
    inherited: async (project) => { asked.push(project); return factory; },
  } });
  const state = () => (core as unknown as { get(): { drawn: readonly Change[]; factory: ReadonlySet<string> } }).get();
  const card = (id: string) => noteCard(id, knowledge(state().drawn), state().factory);
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await settled();
    const own = new History().create("principle_own", "principle", { title: "Name things plainly", description: "Name things plainly." });
    core.take(own.changes, []);
    await settled();
    assert.deepEqual([...knowledge(state().drawn).notes.keys()].sort(), ["principle_copied", "principle_inherited", "principle_own"]);
    assert.equal(card("principle_inherited")?.fromFactory, true);
    assert.equal(card("principle_own")?.fromFactory, undefined);
    const words = descendants(drawing.NoteCard({ card: card("principle_inherited")!, onClose: () => {} })).filter((node): node is string => typeof node === "string").join(" ");
    assert.match(words, /factory/);

    // The product edits one (its own copy, under the factory's id) and the factory's list moves on: a longer history reads it again.
    own.create("principle_copied", "principle", { title: "Test first", description: "The product's own." });
    factory = [record("principle_inherited", "Keep it small")];
    core.take(own.changes, []);
    await settled();
    assert.equal(card("principle_copied")?.fromFactory, undefined, "the product's own copy is its own");
    assert.equal(card("principle_copied")?.summary, "The product's own.");
    assert.ok(asked.length >= 2 && asked.every((project) => project === "site"));
  } finally {
    core.dispose();
  }
});

function descendants(node: ReactNode): ReactNode[] {
  const result: ReactNode[] = [];
  Children.forEach(node, (child) => {
    result.push(child);
    if (isValidElement<{ children?: ReactNode }>(child)) result.push(...descendants(child.props.children));
  });
  return result;
}
