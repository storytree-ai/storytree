/** Capability 2 · Earlier decisions beside their replacements (the knowledge core story). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { History } from "../testing/changes.js";
import { knowledge, storedEdges } from "./ghosts.js";

test("2.1 an accepted decision that supersedes an old one makes it a ghost, even with its cover mark left; a proposal does not", () => {
  const history = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .decision("new", { frontCoverOf: "cap-a", supersedes: ["old"] })
    .decision("maybe", { status: "proposed", supersedes: ["kept"] })
    .decision("kept", { frontCoverOf: "cap-b" });
  const core = knowledge(history.changes);

  assert.deepEqual(core.ghosts.get("old"), { note: "old", evidence: "superseded", replacedBy: "new", beside: "new", label: "superseded by new" });
  assert.equal(core.ghosts.has("kept"), false, "a proposal naming a decision does not supersede it");
  assert.ok(core.active.has("kept"));
  assert.ok(core.proposed.has("maybe"), "a proposed decision is set apart, not a ghost");
  assert.equal(core.ghosts.has("maybe"), false);
  assert.equal(core.active.has("maybe"), false);
});

test("2.2 a new cover on the same shelf linking to the old one, then the old mark cleared, makes a unique 'earlier cover' ghost", () => {
  const replaced = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .decision("new", { frontCoverOf: "cap-a", links: ["old"] })
    .update("old", { frontCoverOf: undefined });
  assert.deepEqual(knowledge(replaced.changes).ghosts.get("old"), {
    note: "old", evidence: "earlier-cover", replacedBy: "new", beside: "new", label: "earlier cover, replaced by new",
  });

  const clearedAlone = new History().decision("old", { frontCoverOf: "cap-a" }).update("old", { frontCoverOf: undefined });
  assert.equal(knowledge(clearedAlone.changes).ghosts.size, 0, "clearing a mark alone proves no replacement");

  const reworded = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .decision("new", { frontCoverOf: "cap-a", links: ["old"] })
    .update("old", { text: "reworded" });
  assert.equal(knowledge(reworded.changes).ghosts.size, 0, "editing the wording proves no replacement");

  const linkedOnly = new History().decision("old", { frontCoverOf: "cap-a" }).decision("new", { frontCoverOf: "cap-a", links: ["old"] });
  assert.equal(knowledge(linkedOnly.changes).ghosts.size, 0, "linking to an old decision proves no replacement");

  const otherShelf = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .decision("elsewhere", { frontCoverOf: "cap-b", links: ["old"] })
    .update("old", { frontCoverOf: undefined });
  assert.equal(knowledge(otherShelf.changes).ghosts.size, 0, "a cover on another shelf is no replacement");

  const linkedAfter = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .update("old", { frontCoverOf: undefined })
    .decision("new", { frontCoverOf: "cap-a", links: ["old"] });
  assert.equal(knowledge(linkedAfter.changes).ghosts.size, 0, "the new cover must be there before the mark is cleared");
});

test("2.3 a chain of replacements ends beside its current successor; a missing or ambiguous one is 'replacement not placed'", () => {
  const chain = new History()
    .decision("first", { frontCoverOf: "cap-a" })
    .decision("second", { frontCoverOf: "cap-a", supersedes: ["first"] })
    .decision("third", { frontCoverOf: "cap-a", supersedes: ["second"] });
  const chained = knowledge(chain.changes);
  assert.equal(chained.ghosts.get("first")?.replacedBy, "second");
  assert.equal(chained.ghosts.get("first")?.beside, "third", "it sits beside the current successor, not the ghost between");
  assert.equal(chained.ghosts.get("second")?.beside, "third");

  const twice = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .decision("one", { frontCoverOf: "cap-a", supersedes: ["old"] })
    .decision("other", { frontCoverOf: "cap-b", supersedes: ["old"] });
  assert.deepEqual(knowledge(twice.changes).ghosts.get("old"), {
    note: "old", evidence: "superseded", replacedBy: undefined, beside: undefined, label: "replacement not placed",
  });

  const gone = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .decision("new", { frontCoverOf: "cap-a", links: ["old"] })
    .update("old", { frontCoverOf: undefined })
    .retire("new");
  const missing = knowledge(gone.changes).ghosts.get("old");
  assert.equal(missing?.beside, undefined, "a successor no longer in the library is not guessed at");
  assert.equal(missing?.label, "replacement not placed");
});

test("2.4 depth and incoming links count only notes that are neither ghosts nor proposed, and replacement is not a link", () => {
  const history = new History()
    .decision("old", { frontCoverOf: "cap-a" })
    .decision("new", { frontCoverOf: "cap-a", supersedes: ["old"], links: ["base"] })
    .decision("maybe", { status: "proposed", links: ["base"] })
    .memory("base")
    .memory("reader", { links: ["base", "new"] })
    .update("old", { links: ["base"] })
    .memory("retired-reader", { links: ["base"] })
    .retire("retired-reader");
  const core = knowledge(history.changes);

  assert.deepEqual([...core.active].sort(), ["base", "new", "reader"]);
  assert.equal(core.linksIn.get("base"), 2, "new and reader; not the ghost, the proposal or a retired note");
  assert.equal(core.linksIn.get("new"), 1, "superseding old is not a link into new, nor out of it");
  assert.equal(core.linksIn.has("old"), false, "a ghost is not sized by links");
  assert.ok(core.notes.has("old"), "a ghost is still a note a read can find");
  assert.equal(core.notes.has("retired-reader"), false);

  const without = knowledge(new History().decision("new", { frontCoverOf: "cap-a", links: ["base"] }).memory("base").memory("reader", { links: ["base", "new"] }).changes);
  assert.deepEqual(core.linksIn, without.linksIn, "the ghost changes no other note's count");
});

test("2.5 a quality control check is read as a live note, linked and counted like any other kind", () => {
  const history = new History().memory("base").create("qa", "check", { title: "Every package has a story", links: ["base"] });
  const core = knowledge(history.changes);

  assert.ok(core.notes.has("qa"));
  assert.ok(core.active.has("qa"));
  assert.equal(core.linksIn.get("base"), 1);
});

test("4.16 two notes are joined when either stores a reference to the other (links or supersedes); a shared neighbour joins nothing", () => {
  const core = knowledge(new History()
    .decision("a", { links: ["b"] })
    .decision("b", {})
    .decision("c", { supersedes: ["b"] })
    .decision("d", { links: ["b"] })
    .changes);
  const joins = storedEdges(core);

  assert.equal(joins("a", "b"), true);
  assert.equal(joins("b", "a"), true, "either direction");
  assert.equal(joins("c", "b"), true);
  assert.equal(joins("a", "d"), false, "both link to b, but not to each other");
  assert.equal(joins("a", "a"), false);
});
