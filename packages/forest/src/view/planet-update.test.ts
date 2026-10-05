/** A live update redraws only what changed (ADR-0836 D1): an update that changed nothing on show changes nothing. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { workStates } from "@storytree/arc-surface";
import { forestScene, type SessionWisp } from "@storytree/forest";
import type { AnnotatedTree } from "@storytree/library";
import { claimsOn, nextScene, sameWisps } from "./planet-update.js";
import { oncePerFrame } from "./planet-navigation.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const tree = (title: string): AnnotatedTree => ({ arcs: [], stories: [
  { id: "a", title, health, capabilities: [] },
  { id: "b", title: "B", health, capabilities: [] },
] });
const places = () => new Map([["a", 1], ["b", 2]]);

test("3.2 a live update whose scene and places draw the same as those on show is not drawn again", () => {
  const shown = forestScene(tree("A"), [], workStates([]));
  assert.equal(nextScene({ scene: shown, places: places() }, forestScene(tree("A"), [], workStates([])), places()), undefined);
  assert.notEqual(nextScene({ scene: shown, places: places() }, forestScene(tree("A"), [], workStates([])), new Map([["a", 1], ["b", 3]])), undefined,
    "a moved place is drawn");
});

test("3.2 a live update that changed one island keeps the other island's objects, so only the changed plate re-derives", () => {
  const shown = forestScene(tree("A"), [], workStates([]));
  const next = nextScene({ scene: shown, places: places() }, forestScene(tree("A renamed"), [], workStates([])), places());
  assert.ok(next !== undefined);
  assert.notEqual(next.islands[0], shown.islands[0]);
  assert.equal(next.islands[1], shown.islands[1]);
});

test("wisps that draw the same as those on show are not drawn again", () => {
  const wisp = (capabilities: string[]): SessionWisp => ({ session: "s", story: "a", colour: "hsl(1, 80%, 68%)", faded: false, capabilities });
  assert.ok(sameWisps([wisp(["c"])], [wisp(["c"])]));
  assert.ok(!sameWisps([wisp(["c"])], [wisp(["c", "d"])]));
  assert.ok(!sameWisps([wisp(["c"])], [{ ...wisp(["c"]), faded: true }]));
});

test("a claim on another island leaves this island's tints as they were, so its territories are not cut again", () => {
  const land = { territories: [{ capability: "mine", lines: 10 }, { lines: 3 }], files: [] };
  const tint = { colour: "hsl(1, 80%, 68%)", faded: false };
  const before = claimsOn(new Map([["mine", tint]]), land);
  assert.equal(claimsOn(new Map([["mine", tint], ["elsewhere", tint]]), land), before);
  assert.notEqual(claimsOn(new Map([["mine", { ...tint, faded: true }]]), land), before);
});

test("the pointer is picked at most once a frame, at its latest place", () => {
  const frames: (() => void)[] = [];
  const picked: number[] = [];
  const move = oncePerFrame((x: number) => picked.push(x), run => frames.push(run));
  move(1); move(2); move(3);
  assert.deepEqual(picked, []);
  frames.splice(0).forEach(run => run());
  assert.deepEqual(picked, [3]);
  move(4);
  frames.splice(0).forEach(run => run());
  assert.deepEqual(picked, [3, 4]);
});
