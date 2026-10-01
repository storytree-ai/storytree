/** A live update redraws only what changed (ADR-0836 D1): an update that changed nothing on show changes nothing. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { workStates } from "@storytree/arc-surface";
import { forestScene, type SessionWisp } from "@storytree/forest";
import type { AnnotatedTree } from "@storytree/library";
import { nextScene, sameWisps } from "./planet-update.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const tree = (title: string): AnnotatedTree => ({ arcs: [], stories: [
  { id: "a", title, health, capabilities: [] },
  { id: "b", title: "B", health, capabilities: [] },
] });
const places = () => new Map([["a", 1], ["b", 2]]);

test("a live update whose scene and places draw the same as those on show is not drawn again", () => {
  const shown = forestScene(tree("A"), [], workStates([]));
  assert.equal(nextScene({ scene: shown, places: places() }, forestScene(tree("A"), [], workStates([])), places()), undefined);
  assert.notEqual(nextScene({ scene: shown, places: places() }, forestScene(tree("A"), [], workStates([])), new Map([["a", 1], ["b", 3]])), undefined,
    "a moved place is drawn");
});

test("a live update that changed one island keeps the other island's objects, so only the changed plate re-derives", () => {
  const shown = forestScene(tree("A"), [], workStates([]));
  const next = nextScene({ scene: shown, places: places() }, forestScene(tree("A renamed"), [], workStates([])), places());
  assert.ok(next !== undefined);
  assert.notEqual(next.islands[0], shown.islands[0]);
  assert.equal(next.islands[1], shown.islands[1]);
});

test("wisps that draw the same as those on show are not drawn again", () => {
  const wisp = (capabilities: string[]): SessionWisp => ({ session: "s", story: "a", colour: "hsl(1, 80%, 68%)", phase: 3, faded: false, capabilities });
  assert.ok(sameWisps([wisp(["c"])], [wisp(["c"])]));
  assert.ok(!sameWisps([wisp(["c"])], [wisp(["c", "d"])]));
  assert.ok(!sameWisps([wisp(["c"])], [{ ...wisp(["c"]), faded: true }]));
});
