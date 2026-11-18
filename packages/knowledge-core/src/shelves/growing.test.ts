import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledge, noteMoments, noteShown, sheetPoints, underShelves } from "@storytree/knowledge-core";
import { History } from "../testing/changes.js";

const shelves = new Map([["north", { x: 0, y: 100 }], ["front", { x: 0, y: -100 }], ["cap", { x: 30, y: -100 }]]);
const floor = { x: -150, y: -150, width: 300, height: 300 };

test("1.9 replaying a growth, each note appears beneath its home once the replay reaches its recorded date, in recorded order", () => {
  const history = new History().story("north").story("front").capability("cap", "front")
    .decision("z-cover", { frontCoverOf: "cap" })
    .decision("a-deep")
    .update("z-cover", { links: ["a-deep"] })
    .decision("loose")
    .decision("m-other", { frontCoverOf: "north" });
  const known = knowledge(history.changes);
  const { points } = sheetPoints(underShelves(history.changes, known), { shelfAt: node => shelves.get(node), floor, depthStep: 7 }, known.notes);
  const first = Date.parse(history.changes[0]!.record.createdAt);
  const moments = noteMoments(points, known.notes, date => (Date.parse(date) - first) / 1000);
  const shownAt = (now: number) => points.filter(point => noteShown(moments.get(point.id), now) > 0).map(point => point.id);
  assert.deepEqual(shownAt(0), [], "nothing before the first note's date");
  const order = [...points].sort((a, b) => moments.get(a.id)! - moments.get(b.id)!).map(point => point.id);
  assert.deepEqual(order, ["z-cover", "a-deep", "loose", "m-other"], "in recorded order, not by id");
  for (const [i, id] of order.entries()) {
    const shown = shownAt(moments.get(id)! + 0.01);
    assert.deepEqual(shown.sort(), order.slice(0, i + 1).sort(), `at ${id}'s moment the notes recorded up to it show`);
  }
  const home = new Map(points.map(point => [point.id, point.home]));
  assert.deepEqual([home.get("z-cover"), home.get("a-deep"), home.get("loose"), home.get("m-other")], ["cap", "cap", undefined, "north"]);
  const at = moments.get("loose")!;
  assert.ok(noteShown(at, at + 0.1) > 0 && noteShown(at, at + 0.1) < 1);
  assert.equal(noteShown(at, at + 5), 1);
  assert.equal(noteShown(at, Infinity), 1);
  assert.equal(noteShown(undefined, 0), 1);
});
