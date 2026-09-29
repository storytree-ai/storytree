import assert from "node:assert/strict";
import { test } from "node:test";
import { arcQueues, queueRun, waitsOnBoard, type QueueArc } from "./waits.js";

const arc = (id: string, on: string[] = [], state: QueueArc["state"] = "blocked"): QueueArc => ({
  id, title: `Arc ${id}`, state, waits: on.map((on) => ({ on, reason: `after ${on}`, forGood: false })),
});

test("4.1 and 4.3 queued arcs live under their blockers, released waits return to the top, and owner questions are never buried", () => {
  const rows = [arc("A", [], "quiet"), arc("B", ["A"]), arc("C", ["A"], "waiting")];
  const queued = arcQueues(rows);
  assert.deepEqual(queued.map(({ arc }) => arc.id), ["A", "C"]);
  assert.deepEqual(queued[0]?.queued.map(({ arc }) => arc.id), ["B"]);
  assert.deepEqual(queued[1]?.arc.waits.map(({ on }) => on), ["A"], "promotion does not release the arc's wait");
  assert.deepEqual(arcQueues([rows[0]!, { ...rows[1]!, waits: [] }]).map(({ arc }) => arc.id), ["A", "B"]);
  assert.deepEqual(arcQueues([arc("B", ["off-scope"])]).map(({ arc }) => arc.id), ["B"], "a blocker outside the selected scope must not hide its dependent");
});

test("4.2 arrows mean a real chain; branching queues are sets, retaining hidden depth and other waits", () => {
  const chain = arcQueues([arc("A", [], "quiet"), arc("B", ["A"]), arc("C", ["B", "elsewhere"])])[0]!;
  assert.deepEqual(queueRun(chain), { shape: "chain", chips: [
    { id: "B", title: "Arc B", hidden: 0, otherWaits: 0, reasons: ["after A"], waitsOn: [] },
    { id: "C", title: "Arc C", hidden: 0, otherWaits: 1, reasons: ["after B", "after elsewhere"], waitsOn: [] },
  ] });
  const branching = arcQueues([arc("A", [], "quiet"), arc("B", ["A"]), arc("C", ["A"]), arc("D", ["B"])])[0]!;
  assert.equal(queueRun(branching).shape, "set");
  assert.deepEqual(queueRun(branching).chips.map(({ title, hidden }) => [title, hidden]), [["Arc B", 1], ["Arc C", 0]]);
});

test("4.4 each wait names its blocker, arc and reason, each blocker names held-up work, and permanent waits explain themselves", () => {
  const work = [{ id: "i", title: "Draw the board", arc: { id: "a", title: "Arc surface" } }, { id: "j", title: "Store waits", arc: { id: "b", title: "Library" } }];
  const holds = new Map([["i", [{ on: "j", reason: "needs wait readings", forGood: true }, { on: "gone", reason: "missing prerequisite", forGood: true }]]]);
  const board = waitsOnBoard(work, holds);
  assert.deepEqual(board.on("i").map(({ title, arc, reason, warning }) => [title, arc?.title, reason, warning]), [
    ["Store waits", "Library", "needs wait readings", "This wait will not release by itself."],
    ["gone (missing)", undefined, "missing prerequisite", "This wait will not release by itself."],
  ]);
  assert.deepEqual(board.heldUpBy("j"), [{ ...work[0], reason: "needs wait readings" }]);
  assert.deepEqual(board.on("unknown"), []);
  assert.equal(waitsOnBoard(work, new Map([["i", [{ on: "j", reason: "needs it", forGood: false }]]])).on("i")[0]?.warning, undefined);
});

test("4.1 and 4.2 an arc whose every open increment waits on work in another visible arc folds under one of them, naming the increment", () => {
  const on = (id: string, arcId: string) => ({ on: id, reason: `needs ${id}`, forGood: false, title: `Build ${id}`, arc: { id: arcId, title: `Arc ${arcId}` } });
  const bar = (state: "queued" | "waiting-on-you" | "open" | "landed", ...waits: ReturnType<typeof on>[]) => ({ reading: { state }, waits });
  const lane = (id: string, state: QueueArc["state"], ...bars: ReturnType<typeof bar>[]): QueueArc => ({ id, title: `Arc ${id}`, state, bars, waits: bars.flatMap(({ waits }) => waits) });
  const rows = [lane("A", "ready", bar("open")), lane("B", "ready", bar("open")),
    lane("Q", "queued", bar("landed"), bar("queued", on("a1", "A")), bar("queued", on("b1", "B"))),
    lane("H", "queued", bar("queued", on("a1", "A")), bar("waiting-on-you")),
    lane("W", "waiting", bar("queued", on("a1", "A"))),
    lane("S", "queued", bar("queued", on("s2", "S")))];
  const queues = arcQueues(rows);
  assert.deepEqual(queues.map(({ arc }) => arc.id), ["A", "B", "H", "W", "S"], "held on the owner, waiting on a question, or on itself: stays on top");
  assert.deepEqual(queueRun(queues[0]!).chips.map(({ id, otherWaits, waitsOn }) => [id, otherWaits, waitsOn]), [["Q", 1, ["Build a1"]]]);
  assert.deepEqual(queues[1]!.queued, [], "folds under one blocker only");
  const cycle = arcQueues([lane("X", "queued", bar("queued", on("y1", "Y"))), lane("Y", "queued", bar("queued", on("x1", "X")))]);
  assert.deepEqual(cycle.map(({ arc }) => arc.id), ["X"], "a cycle is cut, never lost");
  assert.deepEqual(cycle[0]!.queued.map(({ arc }) => arc.id), ["Y"]);
});
