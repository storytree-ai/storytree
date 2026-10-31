/** Capability 1 under the glass sheet: each note is pulled toward every island its links reach, unlinked ones lie on a sea floor (ADR-1063). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledge, selectedLinks, sheetLayout, sheetLit, sheetPoints, underShelves } from "@storytree/knowledge-core";
import { History } from "../testing/changes.js";

const shelves = new Map([["west", { x: -100, y: 20 }], ["east", { x: 100, y: -10 }], ["cap", { x: 130, y: -30 }]]);
const floor = { x: -150, y: -60, width: 300, height: 120 };
const stories = new Map([["west", "west"], ["east", "east"], ["cap", "east"]]);

const hang = (history: History) => {
  const known = knowledge(history.changes);
  const core = underShelves(history.changes, known);
  return { core, ...sheetPoints(core, { shelfAt: node => shelves.get(node), floor, depthStep: 7 }, known.notes) };
};
const islands = () => new History().story("west").story("east").capability("cap", "east");

test("1.10 under the glass sheet a note one island's links reach hangs beneath it, a step deeper per depth, a note citing hung knowledge one step below the deepest it cites, and each stored link between two drawn notes is one line", () => {
  const history = islands()
    .decision("deep")
    .decision("middle", { links: ["deep"] })
    .decision("cover", { frontCoverOf: "cap", links: ["middle"] })
    .decision("citer", { links: ["middle"] });
  const { core, points, links, floor: sea } = hang(history);
  assert.deepEqual(points.map(point => point.id).sort(), ["citer", "cover", "deep", "middle"]);
  assert.equal(core.placed.has("citer"), false, "no shelf reaches the citer");
  const point = (id: string) => points.find(p => p.id === id)!;
  for (const id of ["cover", "middle", "deep", "citer"]) {
    assert.ok(Math.hypot(point(id).at.x - 130, point(id).at.y + 30) < 15, `${id} hangs under the capability's territory`);
    assert.deepEqual(point(id).toward, ["cap"]);
  }
  const below = (id: string) => -point(id).at.z;
  assert.equal(below("middle") - below("cover"), 7, "one step deeper per depth");
  assert.equal(point("middle").depth, core.placed.get("middle")!.depth, "a shelf's depth where a shelf reaches it");
  assert.equal(point("citer").depth, point("middle").depth! + 1, "one step below the deepest note it cites");
  assert.equal(sea.notes, 0, "nothing on the floor");
  assert.deepEqual(links.map(pair => [...pair].sort().join(" ")).sort(), ["citer middle", "cover middle", "deep middle"]);
  assert.deepEqual(hang(history).points, points, "the same library hangs the same way");
});

test("1.12 a note whose links reach two islands settles between them, nearer the one it has more links to, and the many citers of one note keep room from each other", () => {
  let history = islands()
    .decision("w1", { frontCoverOf: "west" }).decision("w2", { frontCoverOf: "west" })
    .decision("e1", { frontCoverOf: "east" })
    .decision("bridge", { links: ["w1", "w2", "e1"] })
    .decision("hub", { frontCoverOf: "east" });
  for (let i = 0; i < 30; i++) history = history.decision(`citer-${String(i).padStart(2, "0")}`, { links: ["hub"] });
  const { points } = hang(history);
  const bridge = points.find(p => p.id === "bridge")!;
  assert.deepEqual(bridge.toward, ["west", "east"], "pulled by both, the stronger first");
  assert.ok(bridge.at.x > -100 + 20 && bridge.at.x < 100 - 20, `between the islands (x ${bridge.at.x.toFixed(1)})`);
  assert.ok(bridge.at.x < 0, `nearer west, which it has two links to (x ${bridge.at.x.toFixed(1)})`);
  const citers = points.filter(p => p.id.startsWith("citer-"));
  let closest = Infinity;
  for (const a of citers) for (const b of citers) if (a !== b) closest = Math.min(closest, Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y));
  assert.ok(closest >= 4, `citers keep room from each other (closest ${closest.toFixed(2)})`);
  assert.ok(citers.every(p => Math.hypot(p.at.x - 100, p.at.y + 10) < 40), "and still hang under their island");
});

test("1.13 adding one note to a library moves no other note by more than a third of a note's room (two ground units)", () => {
  const library = (extra: boolean) => {
    let history = islands().decision("hub", { frontCoverOf: "east" }).decision("w", { frontCoverOf: "west" });
    for (let i = 0; i < 40; i++) history = history.decision(`n-${String(i).padStart(2, "0")}`, { links: [i % 3 === 0 ? "w" : "hub", ...(i % 5 === 0 ? ["hub", "w"] : [])] });
    for (let i = 0; i < 20; i++) history = history.decision(`loose-${String(i).padStart(2, "0")}`);
    if (extra) history = history.decision("n-new", { links: ["hub"] });
    return hang(history).points;
  };
  const before = new Map(library(false).map(p => [p.id, p.at]));
  let moved = 0;
  for (const p of library(true)) {
    const was = before.get(p.id);
    if (was !== undefined) moved = Math.max(moved, Math.hypot(p.at.x - was.x, p.at.y - was.y, p.at.z - was.z));
  }
  assert.ok(moved < 2, `the most any other note moved: ${moved.toFixed(3)}`);
});

test("1.14 notes with no links, or linked only among themselves, lie on one floor below the deepest hanging note, spread across the islands' footprint with each linked group kept together; nothing lies outside it", () => {
  let history = islands().decision("cover", { frontCoverOf: "west" }).decision("deeper", {}).update("cover", { links: ["deeper"] })
    .decision("pair-a", { links: ["pair-b"] }).decision("pair-b");
  for (let i = 0; i < 40; i++) history = history.decision(`loose-${String(i).padStart(2, "0")}`);
  const { points, floor: sea } = hang(history);
  const lying = points.filter(p => p.depth === undefined);
  assert.equal(lying.length, 42);
  assert.equal(sea.notes, 42);
  const deepest = Math.min(...points.filter(p => p.depth !== undefined).map(p => p.at.z));
  for (const p of lying) {
    assert.equal(p.at.z, sea.z, `${p.id} on the one floor`);
    assert.ok(p.at.x >= floor.x && p.at.x <= floor.x + floor.width && p.at.y >= floor.y && p.at.y <= floor.y + floor.height, `${p.id} within the footprint`);
    assert.deepEqual(p.toward, []);
  }
  assert.ok(sea.z < deepest, "below the deepest hanging note");
  const xs = lying.map(p => p.at.x), ys = lying.map(p => p.at.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > floor.width * 0.6 && Math.max(...ys) - Math.min(...ys) > floor.height * 0.6, "spread across the footprint, not piled at an edge");
  let closest = Infinity;
  for (const a of lying) for (const b of lying) if (a !== b && !(a.id.startsWith("pair") && b.id.startsWith("pair"))) closest = Math.min(closest, Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y));
  const pair = lying.filter(p => p.id.startsWith("pair"));
  assert.ok(Math.hypot(pair[0]!.at.x - pair[1]!.at.x, pair[0]!.at.y - pair[1]!.at.y) < closest, "the linked pair lie closer together than any two strangers");
  assert.ok(closest > 10, `evenly spread (closest strangers ${closest.toFixed(1)})`);
});

test("1.15 selecting a story lights every note pulled toward its island, including one between it and another island", () => {
  const history = islands()
    .decision("w1", { frontCoverOf: "west" }).decision("e1", { frontCoverOf: "east" }).decision("c1", { frontCoverOf: "cap" })
    .decision("bridge", { links: ["w1", "e1"] }).decision("loose");
  const { points } = hang(history);
  assert.deepEqual([...sheetLit(points, "east", node => stories.get(node))].sort(), ["bridge", "c1", "e1"]);
  assert.deepEqual([...sheetLit(points, "west", node => stories.get(node))].sort(), ["bridge", "w1"]);
});

test("1.11 under the glass sheet no links show at rest; selecting a story shows exactly the links that touch its notes (ADR-1061 D3)", () => {
  const links: [string, string][] = [["a1", "a2"], ["a2", "b1"], ["b1", "b2"], ["c1", "a1"]];
  assert.deepEqual(selectedLinks(links, undefined), [], "none at rest");
  assert.deepEqual(selectedLinks(links, new Set(["a1", "a2"])), [["a1", "a2"], ["a2", "b1"], ["c1", "a1"]], "the selected story's, and only those");
  assert.deepEqual(selectedLinks(links, new Set()), [], "a story with no notes shows none");
});

test("1.16 the sheet read again after news that changes nothing it lays out keeps its layout, and lays out again when a link, a note or a shelf moves", () => {
  const layout = sheetLayout();
  const read = (history: History, at: ReadonlyMap<string, { x: number; y: number }> = shelves) => {
    const known = knowledge(history.changes);
    // Each reading hands it fresh objects, as the globe's live updates do.
    return layout(underShelves(history.changes, known), { shelfAt: node => at.get(node), floor: { ...floor }, depthStep: 7 }, known.notes);
  };
  const history = islands().decision("cover", { frontCoverOf: "cap" }).decision("citer", { links: ["cover"] }).decision("loose");
  const first = read(history);
  assert.equal(read(history), first, "the same library, read again");
  assert.equal(read(history.update("citer", { title: "Renamed" })), first, "a change to what the sheet does not read");
  const linked = read(history.update("loose", { links: ["citer"] }));
  assert.notEqual(linked, first, "a new link lays out again");
  const { core: _core, ...fresh } = hang(history);
  assert.deepEqual(linked, fresh, "as a fresh layout would");
  assert.notEqual(read(history.decision("new")), linked, "a new note lays out again");
  const moved = new Map([...shelves, ["cap", { x: 120, y: -30 }]]);
  assert.notEqual(read(history, moved), read(history), "a moved shelf lays out again");
});
