/** Capability 1 in a replay (world 7): the core grows as the recording added its notes. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { globePoints, knowledge, noteMoments, noteShown, underShelves } from "@storytree/knowledge-core";
import { History } from "../testing/changes.js";

const spots = new Map([["north", { x: 0, y: 1, z: 0 }], ["front", { x: 0, y: 0, z: 1 }]]);

test("1.9 replaying a growth, each note appears beneath its home once the replay reaches its recorded date, in recorded order", () => {
  // Recorded out of id order: z-cover first, then a-deep, then the loose note, then m-other on the other shelf.
  const history = new History().story("north").story("front").capability("cap", "front")
    .decision("z-cover", { frontCoverOf: "cap" })
    .decision("a-deep")
    .update("z-cover", { links: ["a-deep"] })
    .decision("loose")
    .decision("m-other", { frontCoverOf: "north" });
  const known = knowledge(history.changes);
  const points = globePoints(underShelves(history.changes, known), spots, 218, known.notes);
  // The replay's clock: one second per recorded second, from the first change.
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
  // Each appears where the finished core draws it: under its home, or loose.
  const home = new Map(points.map(point => [point.id, point.home]));
  assert.deepEqual([home.get("z-cover"), home.get("a-deep"), home.get("loose"), home.get("m-other")], ["cap", "cap", undefined, "north"]);
  // A note fades in over a beat, and is whole after it; with no growth, or under reduced motion (now is Infinity), every note is whole.
  const at = moments.get("loose")!;
  assert.ok(noteShown(at, at + 0.1) > 0 && noteShown(at, at + 0.1) < 1);
  assert.equal(noteShown(at, at + 5), 1);
  assert.equal(noteShown(at, Infinity), 1);
  assert.equal(noteShown(undefined, 0), 1);
});
