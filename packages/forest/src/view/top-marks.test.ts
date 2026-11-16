/**
 * Capability 3 · Story node render (the forest story): on an imported island drawn top-down, a capability inside a closed
 * top part has no territory of its own, so the marks keyed to it (a session's claim flag, the selected arc's ring, the
 * selected capability's gold ring) are drawn on the top part holding it (arc_0c4277f81731).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Quaternion, Vector3 } from "three";

import { workStates } from "@storytree/arc-surface";
import type { AnnotatedTree, StorySurvey } from "@storytree/library";
import { claimTints } from "../agent-claims/agent-claims.js";
import { forestScene } from "../render/forest-scene.js";
import { nestedLayout, regionOf } from "../territories/nested-territories.js";
import { territories } from "../territories/territories.js";
import { ClaimMarks } from "./claim-flag.js";
import { openWorkMarks, ringedCapabilities } from "./open-work.js";
import { besideOpen, memberTops, pickedOnTops, rolledToTops } from "./top-marks.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const explored = (id: string, covers: string) => ({ id, title: covers, dependsOn: [], proposed: false, status: "healthy" as const, contracts: [], health, covers: [covers] });
// An imported app: src/ui holds button and form, src/data holds store and cache, src/main.ts is alone at the top.
const tree: AnnotatedTree = { arcs: [], stories: [{ id: "app", title: "app", health, mapped: { from: "/code/app", package: ".", folders: ["."] }, capabilities: [
  explored("button", "src/ui/button"), explored("form", "src/ui/form"), explored("store", "src/data/store"), explored("cache", "src/data/cache"), explored("main", "src/main.ts"),
] }] };
const files = [
  { path: "src/ui/button/index.ts", lines: 100, capability: "button" }, { path: "src/ui/form/index.ts", lines: 300, capability: "form" },
  { path: "src/data/store/index.ts", lines: 50, capability: "store" }, { path: "src/data/cache/index.ts", lines: 70, capability: "cache" },
  { path: "src/main.ts", lines: 40, capability: "main" },
];
const survey: Record<string, StorySurvey> = { app: { files, imports: [], mapped: { folder: "/code/app" } } };
const scene = forestScene(tree, [], workStates([]), survey);
const land = scene.islands[0]!.land!;
const map = territories(land.territories.map(({ capability, lines }) => ({ ...(capability === undefined ? {} : { capability }), lines })), 20);

test("3.121 · a closed top part carries the claim flag, the open-work ring and the gold pick of the capabilities inside it, each still marked on its own id for when the part opens", () => {
  const tops = memberTops(scene.parts ?? []);
  assert.deepEqual([...tops].sort(), [["button", "top:app:ui"], ["cache", "top:app:data"], ["form", "top:app:ui"], ["store", "top:app:data"]]);

  // A session claims form, inside ui; the selected arc's open work names store, inside data; cache is the selected capability.
  const claimed = rolledToTops(claimTints([{ session: "s", story: "app", colour: "#56b4e9", faded: false, capabilities: ["form", "main"] }]), tops);
  const marks = new ClaimMarks();
  marks.setLand(map, (p) => new Vector3(p.x, 0, p.z), () => new Vector3(0, 1, 0), false);
  marks.claims(claimed, 0, { standing: true, reduced: true });
  marks.frame(0, { zoom: 2, eye: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), reduced: true });
  assert.ok(marks.root.getObjectByName("territory-claim:top:app:ui"), "form's flag stands on ui, the closed top part holding it");
  assert.ok(marks.root.getObjectByName("territory-claim:main"), "a lone capability keeps its own flag");
  assert.equal(marks.root.getObjectByName("territory-claim:top:app:data"), undefined, "a top part holding nothing claimed carries no flag");
  assert.deepEqual(claimed.get("form"), { colour: "#56b4e9", faded: false }, "form stays claimed by its own id, for when ui opens");

  const circled = rolledToTops(ringedCapabilities(["store"], undefined, scene.contracts ?? []), tops);
  const open = openWorkMarks(map, circled, undefined, pickedOnTops("cache", tops));
  assert.deepEqual(open.rings.map(({ capability }) => capability), ["top:app:data"], "store's ring is drawn round data");
  assert.equal(open.picked?.capability, "top:app:data", "the selected cache's gold ring is drawn round data");
  assert.ok(circled?.has("store"), "store stays ringed by its own id");
  assert.equal(rolledToTops(undefined, tops), undefined, "no arc selected rings nothing");
  assert.equal(pickedOnTops("main", tops), "main", "a lone capability is picked as itself");
});

test("3.122 · once a top part opens, the claim flag, open-work ring and gold pick of each capability inside it stand on that capability's own territory, and the top part carries none of them", () => {
  const tops = memberTops(scene.parts ?? []);
  const ui = scene.parts!.find(({ capability }) => capability === "top:app:ui")!;
  const layout = nestedLayout(regionOf(map, map.territories.findIndex(({ capability }) => capability === "top:app:ui")), ui.shares, ui.links, [])!;
  const eye = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const flags = (land: typeof map, claimed: ReadonlyMap<string, { colour: string; faded: boolean }>) => {
    const marks = new ClaimMarks();
    marks.setLand(land, (p) => new Vector3(p.x, 0, p.z), () => new Vector3(0, 1, 0), false);
    marks.claims(claimed, 0, { standing: true, reduced: true });
    marks.frame(0, { zoom: 2, eye, reduced: true });
    return marks.root;
  };

  // A session claims form, inside ui; the selected arc's open work names button, inside ui, which is also the selected capability.
  const claimed = rolledToTops(claimTints([{ session: "s", story: "app", colour: "#56b4e9", faded: false, capabilities: ["form", "main"] }]), tops);
  const circled = rolledToTops(ringedCapabilities(["button"], undefined, scene.contracts ?? []), tops);
  const picked = "button";

  // ui's opened land: form's flag on form's territory, button's ring and gold pick on button's.
  const inside = flags(layout.map, claimed);
  assert.ok(inside.getObjectByName("territory-claim:form"), "form's flag stands on form, inside the opened ui");
  const insideWork = openWorkMarks(layout.map, circled, undefined, picked);
  assert.deepEqual(insideWork.rings.map(({ capability }) => capability), ["button"], "button's ring is drawn round button");
  assert.equal(insideWork.picked?.capability, "button", "the selected button's gold ring is drawn round button");

  // The island beside the opened ui: ui carries no flag, ring or pick of its own while it is open; main keeps its flag.
  const outside = flags(map, besideOpen(claimed, "top:app:ui"));
  assert.equal(outside.getObjectByName("territory-claim:top:app:ui"), undefined, "the opened ui carries no flag");
  assert.ok(outside.getObjectByName("territory-claim:main"), "a lone capability keeps its own flag");
  const outsideWork = openWorkMarks(map, besideOpen(circled, "top:app:ui"), undefined, besideOpen(pickedOnTops(picked, tops), "top:app:ui"));
  assert.deepEqual(outsideWork.rings, [], "the opened ui carries no ring");
  assert.equal(outsideWork.picked, undefined, "nor the gold pick");

  // A capability opened into its code parts is no top part: its own marks stay on it.
  assert.ok(besideOpen(claimed, "main").has("main"), "an opened capability keeps its own flag");
  assert.equal(besideOpen("main", "main"), "main", "and its own gold pick");
  assert.equal(besideOpen(undefined, "top:app:ui"), undefined, "no arc selected rings nothing");
});
