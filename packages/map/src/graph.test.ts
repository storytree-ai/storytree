import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnnotatedTree } from "@storytree/library";
import { buildGraph } from "./index.js";
import { focus, focusRows, formatFocus, type FocusRow } from "./focus.js";

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

test("2.2 selects story, capability or contract by identity or unambiguous number and filters after walking", () => {
  const built = graph();
  assert.ok(focus(built, { select: "story:The app", down: 2, kind: ["file"], mode: "show" }).rows?.some(row => row.id === `file:${view}`));
  assert.equal(focus(built, { select: "cap:2", up: 0, mode: "show" }).rows?.[0]?.id, "projects");
  const contract = focus(built, { select: "contract:2.5", up: 0, mode: "show" }).rows?.[0];
  assert.deepEqual([contract?.id, contract?.kind], [promise.id, "contract"]);
  assert.deepEqual(focus(built, { select: "cap:projects", down: 1, kind: ["contract"], mode: "show" }).rows?.map(row => row.id), [promise.id]);
  assert.throws(() => focus(built, { select: "file:missing.ts" }), /not found/i);
  assert.throws(() => focus(built, { select: "cap:projects", up: -1 }), /depth/i);
  const ambiguous = buildGraph({ ...tree, stories: [...tree.stories, { ...tree.stories[0]!, id: "other", capabilities: [{ ...tree.stories[0]!.capabilities[0]!, id: "other-projects" }] }] }, {});
  assert.throws(() => focus(ambiguous, { select: "cap:2" }), /ambiguous/i);
});

test("2.6 a selection in the library's record names, or a bare record id, selects its node", () => {
  const built = graph();
  const selected = (select: string) => focus(built, { select, up: 0, down: 0, mode: "show" }).rows?.[0]?.id;
  assert.equal(selected("capability:projects"), "projects");
  assert.equal(selected("capability:2"), "projects");
  assert.equal(selected("contract:projects-empty"), promise.id);
  assert.equal(selected("promise:projects-empty"), promise.id, "the old spelling still selects a contract");
  assert.equal(selected("projects"), "projects");
  assert.equal(selected("projects-empty"), promise.id);
  assert.equal(selected("app"), "app");
  assert.throws(() => focus(built, { select: "package:app" }), /Select file:<path>, cap:<id\|number>/);
});

test("2.2 a file the map does not carry is refused with why and what to select instead", () => {
  const built = graph();
  const onDisk = () => true;
  assert.throws(() => focus(built, { select: "file:packages/app/package.json" }, { exists: onDisk }),
    /not a source or test file the code survey reads.*story:app \(The app\)/s);
  assert.throws(() => focus(built, { select: "file:apps/desktop/build.mjs" }, { exists: onDisk }), /story:app \(The app\)/);
  assert.throws(() => focus(built, { select: "file:infra/host.mjs" }, { exists: onDisk }), /no story's package holds it/i);
  assert.throws(() => focus(built, { select: "file:packages/app/src/old/projects.ts" }, { exists: () => false }),
    /no such file is on disk.*file:packages\/app\/src\/projects\.ts/s);
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

test("3.1 counts keep each row's depth and kind as their own keys, so a row named __proto__ changes no other object", () => {
  const row = { id: "odd", kind: "story", title: "Odd", depth: "__proto__", health: "healthy" } as unknown as FocusRow;
  try {
    const answer = focusRows(graph(), ["odd"], [row], {});
    assert.equal(({} as Record<string, unknown>).story, undefined);
    assert.deepEqual(Object.entries(answer.counts.byDepth), [["__proto__", { story: 1 }]]);
  } finally {
    delete (Object.prototype as Record<string, unknown>).story;
  }
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
    { id: "link-story", title: "Session management", health, capabilities: [{ ...projects, id: "local-tools", title: "3 · Local tools", dependsOn: [], contracts: [localPromise] }] },
  ] } as unknown as AnnotatedTree;
  const built = buildGraph(plan, { "link-story": { files: [{ path: "src/tool.ts", lines: 1 }], imports: [], tests: [
    { kind: "test", path: "src/foreign.test.ts", titles: [proof, unknown], imports: [{ from: "src/foreign.test.ts", to: "src/tool.ts" }] },
    { kind: "test", path: "src/local.test.ts", titles: [{ number: "3.5", title: "3.5 local proof" }], imports: [] },
  ] } });
  const foreignId = "test:packages/session-management/src/foreign.test.ts";
  assert.deepEqual(built.edges.filter(edge => edge.from === foreignId && edge.kind === "tests").map(edge => edge.to), ["map-proof"]);
  assert.equal(built.nodes.find(node => node.id === foreignId)?.health, "failing");
  assert.deepEqual(built.nodes.find(node => node.id === foreignId)?.testTitles, [proof, unknown]);
  assert.ok(built.edges.some(edge => edge.from === "test:packages/session-management/src/local.test.ts" && edge.to === "local-proof" && edge.kind === "tests"));
});

test("3.7 an imported story, and a file of its imported folder by either path, answer counts first with the word imported and no health word, naming a loop", () => {
  const mapped = (pkg: string) => ({ from: "https://example.test/shop.git", package: pkg, folders: [pkg] });
  const plan = { arcs: [], stories: [
    { id: "cart", title: "@shop/cart", health, capabilities: [], mapped: mapped("packages/cart") },
    { id: "pay", title: "@shop/pay", health, capabilities: [], mapped: mapped("packages/pay") },
  ] } as unknown as AnnotatedTree;
  const built = buildGraph(plan, {
    cart: { files: [{ path: "packages/cart/src/index.ts", lines: 3 }], imports: [], tests: [], dependsOn: ["pay"], mapped: { folder: "/code/shop", loop: ["cart", "pay"] } },
    pay: { files: [{ path: "packages/pay/lib/pay.mjs", lines: 1 }], imports: [], tests: [], dependsOn: ["cart"], mapped: { folder: "/code/shop", loop: ["pay", "cart"] } },
  });
  const counts = focus(built, { select: "story:@shop/cart" });
  assert.equal(counts.rows, undefined);
  assert.deepEqual(counts.counts.byDepth, { 0: { story: 1 }, 1: { story: 1, file: 1 } });
  assert.equal(counts.counts.mapped, 3);
  assert.deepEqual(counts.loops, [["@shop/cart", "@shop/pay"], ["@shop/pay", "@shop/cart"]]);
  const text = formatFocus(counts);
  assert.match(text, /Imported: 3/);
  assert.match(text, /@shop\/cart → @shop\/pay → @shop\/cart/);
  assert.doesNotMatch(text, /health|healthy|failing|untested|verified/i);

  const file = "file:/code/shop/packages/cart/src/index.ts";
  const shown = focus(built, { select: "file:packages/cart/src/index.ts", up: 1, mode: "show" });
  assert.deepEqual(shown.rows?.map(row => [row.id, row.health]), [[file, "mapped"], ["cart", "mapped"]]);
  assert.match(formatFocus(shown), /\[imported\]/);
  assert.doesNotMatch(formatFocus(shown), /health|healthy|failing|untested|verified/i);
  assert.equal(focus(built, { select: "file:/code/shop/packages/cart/src/index.ts", up: 0, mode: "show" }).rows?.[0]?.id, file, "its full path selects it too");
});

test("1.3 an imported file an explored capability covers implements it, and the map answers for either; the capability reads untested (proposed) until it has a contract, as the forest draws it, its files and story staying mapped", () => {
  const explored = { id: "stats", title: "1 · Stats page", proposed: true, status: "proposed", health: { ...health, verified: { state: "not-checked" } }, dependsOn: [], contracts: [], covers: ["app/stats"] };
  const plan = { arcs: [], stories: [{ id: "app", title: "app", health, capabilities: [explored], mapped: { from: "/code/app", package: ".", folders: ["."] } }] } as unknown as AnnotatedTree;
  const survey = { app: { files: [{ path: "app/stats/page.tsx", lines: 40, capability: "stats" }, { path: "app/home.tsx", lines: 9 }], imports: [], tests: [], mapped: { folder: "/code/app" } } };
  const built = buildGraph(plan, survey);
  const page = "file:/code/app/app/stats/page.tsx";
  assert.deepEqual(built.edges.filter(edge => edge.kind === "implements").map(edge => [edge.from, edge.to]), [[page, "stats"]], "only the covered file implements it");
  assert.equal(built.nodes.find(node => node.id === "stats")?.health, "untested", "with no tests tied it reads proposed, not mapped");
  assert.equal(built.nodes.find(node => node.id === "app")?.health, "mapped", "its story stays mapped");
  assert.equal(built.nodes.find(node => node.id === page)?.health, "mapped", "its file stays mapped");
  assert.deepEqual(focus(built, { select: "cap:stats", down: 1, mode: "show" }).rows?.map(row => row.id).sort(), [page, "stats"].sort(), "the capability answers with its files");
  assert.ok(focus(built, { select: "file:app/stats/page.tsx", up: 1, mode: "show" }).rows?.some(row => row.id === "stats"), "and its file with its capability");

  const promised = { ...explored, contracts: [{ id: "totals", title: "1.1 · Shows the week's totals", health: { ...health, verified: { state: "failing" } } }] };
  const later = buildGraph({ ...plan, stories: [{ ...plan.stories[0]!, capabilities: [promised] }] } as unknown as AnnotatedTree, survey);
  assert.equal(later.nodes.find(node => node.id === "stats")?.health, "untested", "given a contract, it is read as any capability");
});

test("3.14 focus on an imported island's file says the island is a black box read only through a crossing, and names the crossing that lists its importers", () => {
  const plan = { arcs: [], stories: [{ id: "shop", title: "shop", health, capabilities: [], mapped: { from: "/code/shop", package: ".", folders: ["."] } }] } as unknown as AnnotatedTree;
  const built = buildGraph(plan, { shop: { files: [{ path: "src/db.py", lines: 9 }, { path: "src/app.py", lines: 4 }], imports: [], tests: [], mapped: { folder: "/code/shop" } } });
  const answer = focus(built, { select: "file:src/db.py" });
  assert.deepEqual(answer.blackBox, { path: "src/db.py", crossing: ["src/db.py"], mode: "show" });
  const text = formatFocus(answer);
  assert.match(text, /black box/);
  assert.match(text, /crossing: \["src\/db\.py"\], mode: show/);
  assert.match(text, /map --crossing src\/db\.py --show/);
  assert.equal(focus(built, { select: "story:shop" }).blackBox, undefined, "a story's focus is not a file's");
  assert.equal(focus(graph(), { select: `file:${view}` }).blackBox, undefined, "a built story's file has its imports read");
});

test("1.4 a contract no test of its story's packages proves names a test numbered for it in a dependent's package, and the shown row says it is not credited there", () => {
  const rows = { id: "rows-persist", title: "1.2 · Rows persist", health: { ...health, verified: { state: "not-checked" } } };
  const kept = { id: "rows-kept", title: "1.3 · Rows are kept", health };
  const plan = { arcs: [], stories: [
    { id: "data", title: "The data", health, capabilities: [{ ...storage, contracts: [rows, kept] }] },
    { id: "app", title: "The app", health, capabilities: [{ ...projects, contracts: [] }] },
    { id: "other", title: "Other", health, capabilities: [] },
  ] } as unknown as AnnotatedTree;
  const stray = { number: "1.2", title: "1.2 · rows persist through the app" };
  const built = buildGraph(plan, {
    data: { files: [], imports: [], tests: [{ kind: "test", path: "src/kept.test.ts", titles: [{ number: "1.3", title: "1.3 · rows are kept" }], imports: [] }] },
    app: { files: [], imports: [], dependsOn: ["data"], tests: [{ kind: "test", path: "src/rows.test.ts", titles: [stray, { number: "1.3", title: "1.3 · the app's own" }], imports: [] }] },
    other: { files: [], imports: [], tests: [{ kind: "test", path: "src/unrelated.test.ts", titles: [{ number: "1.2", title: "1.2 · an unrelated story's own" }], imports: [] }] },
  });
  assert.deepEqual(built.nodes.find(node => node.id === "rows-persist")?.elsewhere, [{ path: "packages/app/src/rows.test.ts", title: stray.title, prefix: "data" }]);
  assert.equal(built.nodes.find(node => node.id === "rows-kept")?.elsewhere, undefined);
  const shown = formatFocus(focus(built, { select: "contract:rows-persist", up: 0, mode: "show" }));
  assert.match(shown, /not credited: test "1\.2 · rows persist through the app" in packages\/app\/src\/rows\.test\.ts sits in another story's package/);
  assert.match(shown, /prefix its title with data/);
});

test("1.5 a contract on an edge joins the graph with its own health, belonging to both capabilities the edge joins and saying the edge, so focus selects it and a focus on either capability lists it beside its own contracts", () => {
  const onEdge = { id: "projects-read-storage", title: "2.7 Projects reads what the cache saved", health: { ...health, verified: { state: "failing" } } };
  const joined = { ...tree, stories: [
    { id: "app", title: "The app", health, capabilities: [projects, { ...storage, id: "cache", title: "3 · Cache" }], edges: [{ id: "edge-1", from: "projects", to: "cache", contracts: [onEdge] }] },
    tree.stories[1],
  ] } as unknown as AnnotatedTree;
  const built = buildGraph(joined, {});
  const selected = focus(built, { select: "contract:2.7", up: 1, mode: "show" });
  assert.deepEqual(selected.rows?.find(row => row.depth === 0), { id: onEdge.id, kind: "contract", title: onEdge.title, story: "app", health: "failing", onEdge: { id: "edge-1", from: "projects", to: "cache" }, number: "2.7", depth: 0, edge: [] });
  assert.deepEqual(selected.rows?.filter(row => row.depth === 1).map(row => row.id).sort(), ["cache", "projects"]);
  assert.deepEqual(focus(built, { select: "cap:projects", down: 1, kind: ["contract"], mode: "show" }).rows?.map(row => row.id), [promise.id, onEdge.id]);
  assert.deepEqual(focus(built, { select: "cap:cache", down: 1, kind: ["contract"], mode: "show" }).rows?.map(row => row.id), [onEdge.id]);
  assert.match(formatFocus(selected), /projects-read-storage .*on edge-1: projects depends on cache/);
});
