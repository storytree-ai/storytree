import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnnotatedTree } from "@storytree/library";
import { buildGraph } from "./index.js";
import { focus } from "./focus.js";

const health = { reported: { state: "not-checked" }, verified: { state: "passing" } } as const;
const promise = { id: "projects-empty", title: "2.5 An empty project shows its next step", health };
const projects = { id: "projects", title: "2 · Projects", proposed: false, status: "healthy", health, dependsOn: ["storage"], contracts: [promise] } as const;
const storage = { id: "storage", title: "1 · Storage", proposed: false, status: "untested", health: { ...health, verified: { state: "not-checked" } }, dependsOn: [], contracts: [] } as const;
const tree = { arcs: [], stories: [
  { id: "app", title: "The app", health, capabilities: [projects] },
  { id: "data", title: "The data", health, capabilities: [storage] },
] } as unknown as AnnotatedTree;
const view = "apps/desktop/src/view/view.ts";
const graph = () => buildGraph(tree, { app: {
  files: [{ path: "../../apps/desktop/src/view/view.ts", lines: 3, capability: "projects" }, { path: "src/projects.ts", lines: 2, capability: "projects" }],
  imports: [{ from: "../../apps/desktop/src/view/view.ts", to: "src/projects.ts" }],
  tests: [{ kind: "test", path: "src/projects.test.ts", titles: [{ number: "2.5", title: "2.5 empty projects" }], imports: [{ from: "src/projects.test.ts", to: "../../apps/desktop/src/view/view.ts" }] }],
} });

test("1.1 joins the plan, imports and numbered tests, preserving declared and inferred provenance", () => {
  const built = graph();
  assert.ok(built.edges.some(e => e.from === "projects" && e.to === "storage" && e.provenance === "declared"));
  assert.ok(built.edges.some(e => e.from === "test:packages/app/src/projects.test.ts" && e.to === promise.id && e.provenance === "inferred"));
  assert.ok(built.edges.some(e => e.from === `file:${view}` && e.to === "file:packages/app/src/projects.ts" && e.kind === "imports"));
  assert.equal(built.nodes.filter(n => n.kind === "test").length, 1);
});

test("1.1 story traversal retains unclaimed files and tests without numbered titles", () => {
  const built = buildGraph(tree, { app: {
    files: [{ path: "src/unclaimed.ts", lines: 1 }], imports: [],
    tests: [{ kind: "test", path: "src/unnumbered.test.ts", titles: [], imports: [] }],
  } });
  const answer = focus(built, { select: "story:The app", down: 1, kind: ["file", "test"], mode: "show" });
  assert.deepEqual(answer.rows?.map(row => row.id).sort(), ["file:packages/app/src/unclaimed.ts", "test:packages/app/src/unnumbered.test.ts"]);
  assert.ok(answer.rows?.every(row => row.depth === 1 && row.health === "untested"));
});

test("2.1 both code files and capabilities return dependencies up and dependents down, bounded by depth", () => {
  const built = graph();
  const up = focus(built, { select: "cap:projects", up: 1, mode: "show" });
  assert.ok(up.rows?.some(row => row.id === "storage" && row.depth === 1));
  assert.ok(!up.rows?.some(row => row.id === `file:${view}`));
  const down = focus(built, { select: "cap:storage", down: 2, mode: "show" });
  assert.ok(down.rows?.some(row => row.id === `file:${view}` && row.depth === 2));
  assert.ok(focus(built, { select: "file:packages/app/src/projects.ts", down: 1, mode: "show" }).rows?.some(row => row.id === `file:${view}`));
  assert.ok(focus(built, { select: `file:${view}`, up: 1, mode: "show" }).rows?.some(row => row.id === "file:packages/app/src/projects.ts"));
});

test("2.2 selects story, capability or promise by identity or unambiguous number and filters after walking", () => {
  const built = graph();
  assert.ok(focus(built, { select: "story:The app", down: 2, kind: ["file"], mode: "show" }).rows?.some(row => row.id === `file:${view}`));
  assert.equal(focus(built, { select: "cap:2", up: 0, mode: "show" }).rows?.[0]?.id, "projects");
  assert.equal(focus(built, { select: "promise:2.5", up: 0, mode: "show" }).rows?.[0]?.id, promise.id);
  assert.throws(() => focus(built, { select: "file:missing.ts" }), /not found/i);
  assert.throws(() => focus(built, { select: "cap:projects", up: -1 }), /depth/i);
  const ambiguous = buildGraph({ ...tree, stories: [...tree.stories, { ...tree.stories[0]!, id: "other", capabilities: [{ ...tree.stories[0]!.capabilities[0]!, id: "other-projects" }] }] }, {});
  assert.throws(() => focus(ambiguous, { select: "cap:2" }), /ambiguous/i);
});

test("2.3 the desktop view up one exposes Projects and its 2.5 promise from the supplied plan", () => {
  const answer = focus(graph(), { select: `file:${view}`, up: 1, mode: "show" });
  assert.ok(answer.rows?.some(row => row.id === "projects" && row.depth === 1));
  assert.ok(answer.rows?.some(row => row.id === promise.id && row.title.startsWith("2.5") && row.depth === 1));
});

test("3.1 counts by depth, kind and health first, with estimated tokens and narrowing hints", () => {
  const answer = focus(graph(), { select: "cap:projects", up: 1 });
  assert.equal(answer.rows, undefined);
  assert.equal(answer.rowCount, 3);
  assert.equal(answer.counts.byDepth[1]?.capability, 1);
  assert.equal(answer.counts.byKind.story, 1);
  assert.deepEqual(answer.counts.health, { healthy: 2, failing: 0, untested: 1 });
  assert.ok(answer.estimatedTokens > 0);
  assert.ok(answer.hints.length > 0);
});

test("3.2 dry-run estimates the complete same answer without returning its rows", () => {
  const options = { select: "cap:projects", down: 2 };
  const dry = focus(graph(), { ...options, mode: "dry_run" });
  const shown = focus(graph(), { ...options, mode: "show" });
  assert.equal(dry.rows, undefined);
  assert.equal(dry.rowCount, shown.rows?.length);
  assert.equal(dry.estimatedTokens, shown.estimatedTokens);
});

test("3.3 show returns every row or refuses with counts above the ceiling, never a partial list", () => {
  const built = graph();
  const options = { select: "cap:projects", down: 2, mode: "show" as const };
  const complete = focus(built, options);
  assert.equal(complete.refused, false);
  const refused = focus(built, options, { ceiling: complete.rowCount - 1 });
  assert.equal(refused.refused, true);
  assert.equal(refused.rows, undefined);
  assert.equal(refused.rowCount, complete.rowCount);
  assert.deepEqual(refused.counts, complete.counts);
});

test("1.1 a dependent's prefixed proof joins the named package's promise and preserves its identity", () => {
  const proof = { package: "map", number: "3.5", title: "map 3.5: the focus tool returns the map's answer" };
  const unknown = { package: "missing", number: "3.5", title: "missing 3.5: no local fallback" };
  const mapPromise = { id: "map-proof", title: "3.5 · Counts through the front door", health: { ...health, verified: { state: "failing" } } };
  const localPromise = { id: "local-proof", title: "3.5 · A different local promise", health };
  const plan = { arcs: [], stories: [
    { id: "map-story", title: "The map", health, capabilities: [{ ...projects, id: "map-counts", title: "3 · Counts", dependsOn: [], contracts: [mapPromise] }] },
    { id: "link-story", title: "The agent link", health, capabilities: [{ ...projects, id: "local-tools", title: "3 · Local tools", dependsOn: [], contracts: [localPromise] }] },
  ] } as unknown as AnnotatedTree;
  const built = buildGraph(plan, { "link-story": { files: [{ path: "src/tool.ts", lines: 1 }], imports: [], tests: [
    { kind: "test", path: "src/foreign.test.ts", titles: [proof, unknown], imports: [{ from: "src/foreign.test.ts", to: "src/tool.ts" }] },
    { kind: "test", path: "src/local.test.ts", titles: [{ number: "3.5", title: "3.5 local proof" }], imports: [] },
  ] } });
  const foreignId = "test:packages/agent-link/src/foreign.test.ts";
  assert.deepEqual(built.edges.filter(edge => edge.from === foreignId && edge.kind === "tests").map(edge => edge.to), ["map-proof"]);
  assert.equal(built.nodes.find(node => node.id === foreignId)?.health, "failing");
  assert.deepEqual(built.nodes.find(node => node.id === foreignId)?.testTitles, [proof, unknown]);
  assert.ok(built.edges.some(edge => edge.from === "test:packages/agent-link/src/local.test.ts" && edge.to === "local-proof" && edge.kind === "tests"));
});
