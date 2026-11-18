// Capability 3 · Story node render
import assert from "node:assert/strict";
import { test } from "node:test";
import { Quaternion, Vector3, type Mesh } from "three";

import { workStates } from "@storytree/arc-surface";
import type { AnnotatedTree, StorySurvey } from "@storytree/library";
import { claimTints } from "../agent-claims/agent-claims.js";
import { forestScene } from "../render/forest-scene.js";
import { nestedLayout, regionOf } from "../territories/nested-territories.js";
import { territories, territoryAt } from "../territories/territories.js";
import { ClaimMarks } from "./claim-flag.js";
import { capabilityPlates } from "./nameplates.js";
import { openWorkMarks, ringedCapabilities } from "./open-work.js";
import { besideOpen, memberTops, OpenedTopMarks, pickedOnTops, rolledToTops } from "./top-marks.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const explored = (id: string, covers: string) => ({ id, title: covers, dependsOn: [], proposed: false, status: "healthy" as const, contracts: [], health, covers: [covers] });
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
  const flat = (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z), up = () => new Vector3(0, 1, 0);

  const claimed = rolledToTops(claimTints([{ session: "s", story: "app", colour: "#56b4e9", faded: false, capabilities: ["form", "main"] }]), tops);
  const circled = rolledToTops(ringedCapabilities(["button"], undefined, scene.contracts ?? []), tops);
  const picked = "button";

  const inside = new OpenedTopMarks();
  inside.setLand("top:app:ui", layout, flat, flat, up);
  inside.claims(claimed, 0, { standing: true, reduced: true });
  inside.rings(circled, undefined, picked, 2);
  inside.frame(0, { zoom: 2, eye, reduced: true });
  const near = (p: Vector3, q: { x: number; z: number }) => Math.hypot(p.x - q.x - layout.centre.x, p.z - q.z - layout.centre.z) < 1e-6;
  const at = (capability: string) => layout.map.territories.findIndex((territory) => territory.capability === capability);
  const flag = inside.root.getObjectByName("territory-claim:form")?.getObjectByName("claim-flag");
  assert.ok(flag, "form's flag stands inside the opened ui");
  assert.ok(layout.map.cells.some(({ site, territory }) => territory === at("form") && near(flag.position, site)), "on form's own territory");
  assert.equal(territoryAt(map, flag.position.x, flag.position.z)?.capability, "top:app:ui", "on ui's land");
  assert.equal(inside.root.getObjectByName("territory-claim:main"), undefined, "a capability outside ui is not flagged on its land");
  const centreOf = (name: string) => { const mesh = inside.root.getObjectByName(name) as Mesh; mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox!.getCenter(new Vector3()); };
  const button = capabilityPlates(layout.map).find(({ capability }) => capability === "button")!;
  assert.ok(near(centreOf("open-work-ring:button"), button), "button's ring is drawn round button");
  assert.ok(near(centreOf("picked-ring:button"), button), "the selected button's gold ring is drawn round button");
  inside.dispose();

  const outside = new ClaimMarks();
  outside.setLand(map, flat, up, false);
  outside.claims(besideOpen(claimed, "top:app:ui"), 0, { standing: true, reduced: true });
  outside.frame(0, { zoom: 2, eye, reduced: true });
  assert.equal(outside.root.getObjectByName("territory-claim:top:app:ui"), undefined, "the opened ui carries no flag");
  assert.ok(outside.root.getObjectByName("territory-claim:main"), "a lone capability keeps its own flag");
  const outsideWork = openWorkMarks(map, besideOpen(circled, "top:app:ui"), undefined, besideOpen(pickedOnTops(picked, tops), "top:app:ui"));
  assert.deepEqual(outsideWork.rings, [], "the opened ui carries no ring");
  assert.equal(outsideWork.picked, undefined, "nor the gold pick");

  assert.ok(besideOpen(claimed, "main").has("main"), "an opened capability keeps its own flag");
  assert.equal(besideOpen("main", "main"), "main", "and its own gold pick");
  assert.equal(besideOpen(undefined, "top:app:ui"), undefined, "no arc selected rings nothing");
  const parts = new OpenedTopMarks();
  parts.setLand("main", layout, flat, flat, up);
  parts.claims(new Map([["form", { colour: "#56b4e9", faded: false }]]), 0, { standing: true, reduced: true });
  assert.deepEqual(parts.rings(new Set(["button"]), undefined, "button", 2), [], "no ring drawn on a capability's code parts");
  assert.equal(parts.root.getObjectByName("territory-claim:form"), undefined, "nor a flag");
});
