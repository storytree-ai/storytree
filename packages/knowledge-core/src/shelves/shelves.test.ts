/** Capability 1 · Knowledge under its shelves (the knowledge core story). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { knowledge } from "../ghosts/ghosts.js";
import { History } from "../testing/changes.js";
import { underShelves } from "../index.js";
import { EMPTY_SHELF, LOOP_LABEL } from "./shelves.js";

const core = (history: History) => underShelves(history.changes, knowledge(history.changes));

test("1.1 depth is the longest chain from the shelf, the shelf-to-cover step counting 1, and link counts never change it", () => {
  const history = new History()
    .story("s").capability("cap", "s")
    .memory("c").memory("b", { links: ["c"] })
    .decision("a", { frontCoverOf: "cap", links: ["b", "c"] });
  const placed = core(history).placed;
  assert.equal(placed.get("a")?.depth, 1);
  assert.equal(placed.get("b")?.depth, 2);
  assert.equal(placed.get("c")?.depth, 3, "the shortcut a -> c does not pull c up to 2");

  const more = history.memory("fan-1", { links: ["c"] }).memory("fan-2", { links: ["c"] });
  assert.equal(core(more).placed.get("c")?.depth, 3, "more links into c, from notes on no shelf, leave its depth alone");
});

test("1.2 a note two shelves reach appears once at its greatest depth, naming both; a cover keeps its own shelf as home", () => {
  const history = new History()
    .story("s").capability("older", "s").capability("newer", "s")
    .memory("shared")
    .decision("deep", { frontCoverOf: "older", links: ["shared"] })
    .memory("middle", { links: ["deep"] })
    .decision("top", { frontCoverOf: "newer", links: ["middle", "shared"] });
  const { placed } = core(history);
  assert.deepEqual(placed.get("shared"), { note: "shared", depth: 4, home: "older", entrances: ["older", "newer"], loop: undefined });
  assert.equal(placed.get("deep")?.home, "older", "a front cover keeps its own shelf");
  assert.equal(placed.get("deep")?.depth, 3, "reached deeper from the newer shelf, it sits at its greatest depth");
  assert.deepEqual(placed.get("deep")?.entrances, ["older", "newer"]);
  assert.equal(placed.get("middle")?.home, "newer", "reached from one shelf only");

  const tie = new History()
    .story("s").capability("b-cap", "s").capability("a-cap", "s")
    .memory("n").decision("x", { frontCoverOf: "b-cap", links: ["n"] }).decision("y", { frontCoverOf: "a-cap", links: ["n"] });
  assert.equal(core(tie).placed.get("n")?.home, "b-cap", "the oldest shelf wins, whatever the ids");
});

test("1.3 a loop is drawn as a labelled error at one group depth, and what lies beyond it keeps its longest chain", () => {
  const history = new History()
    .story("s").capability("cap", "s")
    .memory("b").memory("c", { links: ["b", "d"] }).memory("d")
    .update("b", { links: ["c"] })
    .decision("a", { frontCoverOf: "cap", links: ["b"] })
    .memory("x").memory("y", { links: ["x"] }).update("x", { links: ["y"] });
  const { placed, loops, outside } = core(history);
  assert.equal(placed.get("b")?.depth, 2);
  assert.equal(placed.get("c")?.depth, 2);
  assert.equal(placed.get("d")?.depth, 3);
  assert.equal(placed.get("b")?.loop, placed.get("c")?.loop);
  const reached = loops.find(({ members }) => members.includes("b"));
  assert.deepEqual(reached, { id: placed.get("b")?.loop, members: ["b", "c"], depth: 2, label: LOOP_LABEL });
  assert.match(LOOP_LABEL, /refused/, "the label calls it an error, not a supported shape");

  const unreachable = loops.find(({ members }) => members.includes("x"));
  assert.equal(unreachable?.depth, undefined, "an unreachable loop has no depth");
  assert.deepEqual(outside, ["x", "y"]);
  assert.equal(placed.has("x"), false);
});

test("1.4 forty covers on their shelves and five notes on none give forty at depth 1 and five outside; an empty shelf says so", () => {
  const history = new History().story("s");
  for (let cap = 0; cap < 10; cap++) history.capability(`cap-${cap}`, "s");
  history.capability("bare", "s");
  for (let cover = 0; cover < 40; cover++) history.decision(`cover-${String(cover).padStart(2, "0")}`, { frontCoverOf: `cap-${cover % 10}` });
  for (let loose = 0; loose < 5; loose++) history.decision(`project-${loose}`);
  const { placed, outside, shelves } = core(history);

  assert.equal(placed.size, 40);
  assert.ok([...placed.values()].every(({ depth, entrances }) => depth === 1 && entrances.length === 1));
  assert.deepEqual(outside, ["project-0", "project-1", "project-2", "project-3", "project-4"]);
  assert.deepEqual(shelves.find(({ node }) => node === "cap-3")?.covers, ["cover-03", "cover-13", "cover-23", "cover-33"]);
  assert.deepEqual(shelves.find(({ node }) => node === "bare"), { node: "bare", story: "s", covers: [], empty: EMPTY_SHELF });
  assert.equal(shelves.find(({ node }) => node === "cap-3")?.empty, undefined);
  assert.equal(shelves.find(({ node }) => node === "s")?.story, "s", "a story's own shelf is on its own island");
});
