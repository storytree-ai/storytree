import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnnotatedTree } from "@storytree/library";
import { drawingOf, keptDrawing, keptTree } from "./kept-tree.js";

const tree: AnnotatedTree = { arcs: [{ id: "arc_1" }] as AnnotatedTree["arcs"], stories: [{
  id: "story_1", title: "The library", health: { reported: { state: "not-checked" }, verified: { state: "passing" } },
  capabilities: [{ id: "cap_1", title: "Records", dependsOn: [], health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } }, contracts: [] }],
}] as unknown as AnnotatedTree["stories"] };

test("the forest keeps each project's last tree for the next start, and draws no kept value of another shape", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  keptTree("site", storage).write(tree);
  assert.deepEqual(keptTree("site", storage).read(), tree);
  assert.equal(keptTree("other", storage).read(), undefined);
  for (const [key] of values) values.set(key, JSON.stringify({ stories: [{ id: "story_1" }], arcs: [] }));
  assert.equal(keptTree("site", storage).read(), undefined);
});

test("3.48 a start on an unchanged project draws once: the forest drawn from what was kept equals the one drawn after the fresh read and the survey land", async () => {
  const { forestScene, changedIslands } = await import("./forest-scene.js");
  const { storyNodes } = await import("../story-nodes/story-nodes.js");
  const { nextScene } = await import("../view/planet-update.js");
  const { workStates } = await import("@storytree/arc-surface");
  const capability = (id: string, dependsOn: string[] = []) => ({ id, title: `The ${id}`, dependsOn, status: "proposed", contracts: [], health: { reported: { state: "passing" }, verified: { state: "passing" } } });
  const story = (id: string, ...capabilities: ReturnType<typeof capability>[]) => ({ id, title: id, capabilities, health: { reported: { state: "passing" }, verified: { state: "passing" } } });
  // The tree lists the stories in another order than they were created in, the survey ranks story_a above story_b, and story_c and story_d tie in the bottom row.
  const project = { arcs: [], stories: [story("story_a", capability("cap_a")), story("story_d", capability("cap_d")), story("story_c", capability("cap_c")), story("story_b", capability("cap_b"))] } as unknown as AnnotatedTree;
  const at = new Date(0).toISOString();
  const history = ["story_c", "story_b", "story_a", "story_d"].map((id, index) => ({ seq: index + 1, recordId: id, type: "story", action: "created", record: { id, type: "story", version: 1, fields: {}, createdAt: at, updatedAt: at } })) as never[];
  const states = workStates([{ seq: 1, project: "shop", at, kind: "landed", session: "s1", source: "tool", capability: "cap_c" }] as never[]);
  const surveyed = (lines: number) => ({
    story_a: { files: [{ path: "src/a.ts", lines, capability: "cap_a" }], imports: [], tests: [{ kind: "test" as const, path: "src/a.test.ts", titles: [], imports: [] }], edges: [{ story: "story_b", from: "cap_a", to: "cap_b" }] },
    story_b: { files: [{ path: "src/b.ts", lines: 40, capability: "cap_b" }], imports: [] },
  });
  const drawn = (survey: Parameters<typeof forestScene>[3], tree = project, created: Parameters<typeof forestScene>[1] = history, by: Parameters<typeof forestScene>[2] = states) =>
    ({ scene: forestScene(tree, created, by, survey), places: new Map(storyNodes(tree, created, survey).map((node) => [node.id, node.place])) });

  // The last start kept its tree and what it drew it with.
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  keptTree("shop", storage).write(project);
  keptDrawing("shop", storage).write(drawingOf(project, history, states, surveyed(120)));

  // This start: drawn from what was kept, before the page reading's history or the log is restored.
  const tree = keptTree("shop", storage).read()!;
  const kept = keptDrawing("shop", storage).read()!;
  const first = drawn(kept.survey, tree, kept.created, kept.states);
  const fresh = drawn(surveyed(120));
  assert.deepEqual(changedIslands(first.scene, fresh.scene), [], "no island is redrawn when the fresh read and survey land");
  assert.equal(nextScene(first, fresh.scene, fresh.places), undefined, "the globe draws nothing more, so the roads are routed once");

  // A stale kept survey is still drawn, and the fresh one redraws only the island it changed.
  assert.deepEqual(changedIslands(first.scene, drawn(surveyed(300)).scene), ["story_a"]);

  // A drawing kept by an older build, in another shape, is not drawn.
  for (const [key, value] of values) if (key.includes("drawing")) values.set(key, JSON.stringify({ survey: {}, created: "story_a" }));
  assert.equal(keptDrawing("shop", storage).read(), undefined);
  assert.equal(keptDrawing("other", storage).read(), undefined);
});
