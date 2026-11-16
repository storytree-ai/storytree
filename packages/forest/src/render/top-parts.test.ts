/**
 * Capability 3 · Story node render (the forest story): an imported island opens top-down, from its top folders to its
 * capabilities (question_a70f36ca932a).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { workStates } from "@storytree/arc-surface";
import type { CapabilityWord } from "@storytree/forest-world/scene";
import type { AnnotatedTree, StorySurvey } from "@storytree/library";
import { forestScene } from "./forest-scene.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const explored = (id: string, status: CapabilityWord, covers: string[], more: { dependsOn?: string[]; parkedOn?: { arc: string; title: string }[] } = {}) =>
  ({ id, title: covers[0]!, dependsOn: more.dependsOn ?? [], proposed: false, status, contracts: [], health, covers, ...(more.parkedOn === undefined ? {} : { parkedOn: more.parkedOn }) });
// An imported app: src/ui holds two capabilities, src/data two (both parked), src/main.ts is one alone at the top; and a
// built story beside it whose capability depends on one inside src/ui.
const tree: AnnotatedTree = { arcs: [], stories: [
  { id: "app", title: "app", health, mapped: { from: "/code/app", package: ".", folders: ["."] }, capabilities: [
    explored("button", "healthy", ["src/ui/button"], { dependsOn: ["form"] }),
    explored("form", "unhealthy", ["src/ui/form"], { dependsOn: ["store"] }),
    explored("store", "proposed", ["src/data/store"], { parkedOn: [{ arc: "arc-1", title: "Later" }] }),
    explored("cache", "proposed", ["src/data/cache"], { parkedOn: [{ arc: "arc-1", title: "Later" }], dependsOn: ["store"] }),
    explored("main", "untested", ["src/main.ts"], { dependsOn: ["button", "form"] }),
  ] },
  { id: "web", title: "web", health, capabilities: [{ id: "page", title: "1 · Page", dependsOn: ["button"], proposed: false, status: "healthy" as const, contracts: [], health }] },
] };
const files = [
  { path: "src/ui/button/index.ts", lines: 100, capability: "button" }, { path: "src/ui/form/index.ts", lines: 300, capability: "form" },
  { path: "src/data/store/index.ts", lines: 50, capability: "store" }, { path: "src/data/cache/index.ts", lines: 70, capability: "cache" },
  { path: "src/main.ts", lines: 40, capability: "main" }, { path: "scripts/build.ts", lines: 500 },
];
const survey: Record<string, StorySurvey> = { app: { files, imports: [], mapped: { folder: "/code/app" } } };
const scene = forestScene(tree, [], workStates([]), survey);

test("3.50 · an imported island's capabilities sharing a top folder are drawn as one top part, its word rolled up from theirs, beside the brown unexplored rest drawn once", () => {
  assert.deepEqual(scene.islands[0]!.land!.territories, [
    { capability: "top:app:ui", title: "ui", description: "src/ui/button, src/ui/form", status: "unhealthy", mapped: true, lines: 400 },
    { capability: "top:app:data", title: "data", description: "src/data/store, src/data/cache", status: "proposed", parked: true, mapped: true, lines: 120 },
    { capability: "main", title: "src/main.ts", status: "untested", mapped: true, lines: 40 },
    { mapped: true, lines: 500 },
  ], "two top parts where their first capability stood, red because one inside is, grey because both inside are parked; the lone capability keeps its own territory; one brown rest");
  assert.equal(scene.islands[0]!.area, forestScene({ ...tree, stories: [{ ...tree.stories[0]!, capabilities: tree.stories[0]!.capabilities.map(({ covers: _covers, ...capability }) => capability) }, tree.stories[1]!] }, [], workStates([]), survey).islands[0]!.area, "grouping moves no land");

  const flat = forestScene({ ...tree, stories: [{ ...tree.stories[0]!, capabilities: tree.stories[0]!.capabilities.filter(({ id }) => id !== "form" && id !== "cache") }] }, [], workStates([]), survey);
  assert.deepEqual(flat.islands[0]!.land!.territories.map(({ capability }) => capability), ["button", "store", "main", undefined], "a capability alone in its top folder is drawn as itself: a flat island is unchanged");
  assert.equal(flat.parts, undefined, "and nothing opens");
});

test("3.117 · roads between an imported island's top parts roll up the links between the capabilities inside them, one per pair and way; a road from outside reaches the top part", () => {
  assert.deepEqual(new Set(scene.links!.map(({ from, to }) => `${from}->${to}`)), new Set(["top:app:ui->top:app:data", "main->top:app:ui", "page->top:app:ui"]),
    "form->store becomes ui->data; main's two links into ui are one road; button->form and cache->store run inside a top part, so no road at this level; page reaches ui");
});

test("3.118 · a top part opens into the capabilities inside it, each with its own word and lines, the roads between them, and the capabilities each rolled-up road reaches inside it", () => {
  const ui = scene.parts?.find(({ capability }) => capability === "top:app:ui");
  assert.deepEqual(ui, {
    story: "app", capability: "top:app:ui",
    shares: [{ capability: "button", title: "src/ui/button", lines: 100, status: "healthy" }, { capability: "form", title: "src/ui/form", lines: 300, status: "unhealthy" }],
    links: [{ from: "button", to: "form" }],
    lanes: { "main->top:app:ui": ["button", "form"], "page->top:app:ui": ["button"], "top:app:ui->top:app:data": ["form"] },
  });
  const data = scene.parts?.find(({ capability }) => capability === "top:app:data");
  assert.deepEqual(data?.shares.map(({ capability, parked }) => [capability, parked]), [["store", true], ["cache", true]], "a parked capability inside stays parked");
  assert.deepEqual(data?.links, [{ from: "cache", to: "store" }]);
});
