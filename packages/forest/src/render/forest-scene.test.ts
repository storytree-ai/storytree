/**
 * Capability 3 · Story node render (the forest story): the plan the page draws the 3D forest from.
 * Every story node is an island at its place, carrying its grove, and named; what the page drew is
 * said as the smoke check reads it (every story and capability by id); a change redraws only the islands it changed; and a click on the
 * ground picks the island there. The library's tree and history, and the agent log's lines, are
 * written out here as the app hands them to the page, so no database and no app are needed. The
 * look itself is judged by the owner's eye.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/session-management";
import { workStates } from "@storytree/arc-surface";
import type { AnnotatedCapability, AnnotatedStory, AnnotatedTree, Change } from "@storytree/library";

import { changedIslands, forestDrawn, forestScene } from "./forest-scene.js";

const NO_HEALTH = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };

/** A project: three stories, the first with two capabilities, the second with one, the third with none yet. */
function project(): { tree: AnnotatedTree; history: Change[] } {
  const capability = (id: string): AnnotatedCapability => ({ id, title: `The ${id}`, dependsOn: [], proposed: true, status: "proposed" as const, contracts: [], health: NO_HEALTH });
  const story = (id: string, title: string, ...capabilities: AnnotatedCapability[]): AnnotatedStory => ({ id, title, capabilities, health: NO_HEALTH });
  const stories = [
    story("story_1", "Visitor can sign up", capability("cap_1a"), capability("cap_1b")),
    story("story_2", "Visitor can log in", capability("cap_2a")),
    story("story_3", "Admin sees sign-ups"),
  ];
  const history = stories.map(({ id, title }, index): Change => {
    const at = new Date(Date.UTC(2026, 8, 27, 12, 0, index)).toISOString();
    return { seq: index + 1, recordId: id, type: "story", action: "created", record: { id, type: "story", version: 1, fields: { title }, createdAt: at, updatedAt: at } };
  });
  return { tree: { stories, arcs: [] }, history };
}

function log(...written: NewLine[]): Line[] {
  return written.map((line, index) => ({ ...line, seq: index + 1, project: "shop", at: new Date(0).toISOString() }));
}

const claimed = (capability: string): NewLine => ({ kind: "claimed", session: "s1", source: "tool", capability, reason: "building it" });
const landed = (capability: string): NewLine => ({ kind: "landed", session: "s1", source: "tool", capability });

test("3.1 every story is drawn as a story node with its capability tree, and what the page drew names them all", () => {
  const { tree, history } = project();
  const scene = forestScene(tree, history, workStates([]));
  assert.deepEqual(scene.islands.map(({ story, trees }) => [story, trees.map(({ capability }) => capability)]), [
    ["story_1", ["cap_1a", "cap_1b"]],
    ["story_2", ["cap_2a"]],
    ["story_3", [undefined]],
  ]);
  const drawn = forestDrawn(scene);
  assert.equal(drawn.surface, "forest");
  assert.deepEqual(drawn.stories, ["story_1", "story_2", "story_3"]);
  assert.deepEqual(drawn.capabilities, ["cap_1a", "cap_1b", "cap_2a"]);
});

test("3.2 a capability landing redraws just its story node", () => {
  const { tree, history } = project();
  const before = forestScene(tree, history, workStates(log(claimed("cap_2a"))));
  const after = forestScene(tree, history, workStates(log(claimed("cap_2a"), landed("cap_2a"))));
  assert.deepEqual(changedIslands(before, after), ["story_2"]);
  assert.deepEqual(changedIslands(after, forestScene(tree, history, workStates(log(claimed("cap_2a"), landed("cap_2a"))))), [], "nothing changed, nothing redrawn");
});

test("3.4 each story node shows its story's name", () => {
  const { tree, history } = project();
  assert.deepEqual(forestDrawn(forestScene(tree, history, workStates([]))).labels, ["Visitor can sign up", "Visitor can log in", "Admin sees sign-ups"]);
});

test("3.18 a surveyed island's land carries its package and the imports between its files, for the traversal to hop by", () => {
  const { tree, history } = project();
  const survey = { story_2: { files: [{ path: "src/a.ts", lines: 10, capability: "cap_2a" }, { path: "src/b.ts", lines: 5 }], imports: [{ from: "src/b.ts", to: "src/a.ts" }] } };
  const scene = forestScene(tree, history, workStates([]), survey);
  const land = scene.islands.find(({ story }) => story === "story_2")!.land!;
  assert.equal(land.package, "visitor-can-log-in");
  assert.deepEqual(land.imports, [{ from: "src/b.ts", to: "src/a.ts" }]);
});
