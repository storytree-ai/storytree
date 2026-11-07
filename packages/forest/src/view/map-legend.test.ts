/**
 * Capability 4 · Drill-down: the story panel's legend says what the selected island draws (ADR-1236, as narrowed by ADR-1253),
 * nothing missing from it and nothing it lists missing from the map (4.39).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, LineSegments, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from "three";
import { islandSurface, SEA_LANE, SEA_LANE_FILL } from "@storytree/forest-world/geometry";
import type { CapabilityWord } from "@storytree/forest-world/scene";

import { islandRoads } from "../territories/island-roads.js";
import { islandRelief } from "../territories/island-relief.js";
import { linkLayout, LIBRARY_LAND } from "../territories/link-layout.js";
import type { Coast, Point } from "../territories/territories.js";
import { ClaimMarks } from "./claim-flag.js";
import { islandReliefMarks } from "./island-relief.js";
import { islandRoadMarks, landFill, lightRoute } from "./island-roads.js";
import { MAP_LEGEND, renderMapLegend } from "./map-legend.js";
import { capabilityPlates } from "./nameplates.js";
import { openWorkLayer, openWorkMarks } from "./open-work.js";
import { GLYPHS } from "./settlement-symbols.js";
import { renderStoryPanel } from "./story-panel.js";
import { lightTerritories, territoryLand } from "./territory-land.js";

// One island drawing every mark: a capability of each of the six kinds (The library's ids), every word, a parked one, mapped
// land and Unclaimed code, a tunnel, a gate picked, an arc selected, a session's reads and a claim.
const R = Math.sqrt(LIBRARY_LAND / Math.PI);
const coast: Coast = [Array.from({ length: 96 }, (_, i) => ({ x: R * Math.cos(i * Math.PI / 48), z: R * Math.sin(i * Math.PI / 48) }))];
const kinds = ["capability_5e0362aae607", "capability_f27ac2abb10b", "capability_75d059640d9d", "capability_a954e1eb16f6", "capability_13b04e769a4b", "capability_a7f068502213"];
const shares = [...kinds, "mapped", "unclaimed"].map((capability, i) => ({ capability, title: `${i + 1} · ${capability}`, lines: 900 - 80 * i }));
// The link from the second kind to the fifth must cross a third territory, so the island has a tunnel.
const links = [{ from: "z1", to: kinds[0]! }, { from: "z2", to: kinds[1]! }, ...kinds.slice(1).map((from, i) => ({ from, to: kinds[i]! })), { from: kinds[1]!, to: kinds[4]! }];
const docks = [{ local: { x: R, z: 0 }, links: ["z1->" + kinds[0], "z2->" + kinds[1]] }];
const laid = linkLayout(shares, coast, links, docks);
const roads = islandRoads(laid, links, docks, capabilityPlates(laid));
const words = ["healthy", "unhealthy", "proposed", "untested", "healthy", "untested"] as const;
const map = {
  ...laid,
  territories: laid.territories.map((territory): Omit<typeof territory, "capability"> & { capability?: string; status?: CapabilityWord; parked?: true; mapped?: true } => {
    const at = kinds.indexOf(territory.capability ?? "");
    if (at >= 0) return { ...territory, status: words[at]!, ...(at === 4 ? { parked: true as const } : {}) };
    const { capability: _, ...rest } = territory;
    return territory.capability === "mapped" ? { ...rest, mapped: true as const } : rest;
  }),
};
const flat = (p: Point) => new Vector3(p.x, 0, p.z);

function drawnIsland(): Object3D {
  const land = territoryLand(map, flat, coast, new Map(), roads);
  const relief = islandRelief(map, roads), fill = landFill(map, land);
  const roadMarks = islandRoadMarks(roads, flat, fill, relief);
  // A gate picked, so its ring is drawn (3.88).
  lightRoute(roadMarks, roads, { kind: "gate", gate: 0, between: roads.gates[0]!.between });
  land.add(islandReliefMarks(relief, flat, fill), roadMarks);
  lightTerritories(land, new Map([[kinds[0]!, "in-window" as const]]), "#56b4e9");
  const work = openWorkLayer(openWorkMarks(map, new Set([kinds[0]!]), roads), land, flat, 1);
  const claims = new ClaimMarks();
  claims.setLand(map, flat, () => new Vector3(0, 1, 0), true, coast);
  claims.claims(new Map([[kinds[2]!, { colour: "#e69f00", faded: false }]]), 0, { standing: false, reduced: false });
  claims.frame(0.7, { zoom: 20, eye: new Quaternion(), reduced: false });
  land.add(work, claims.root, islandSurface(coast, 40, "story", 3));
  return land;
}

/** Each drawn mark's name up to its first colon, leaving out what draws no colour (the island's depth only hides). */
function drawnNames(root: Object3D): Set<string> {
  const names = new Set<string>();
  root.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    if ((object.material as MeshBasicMaterial).colorWrite === false) return;
    names.add(object.name.split(":")[0]!);
  });
  return names;
}

test("4.39 every mark the selected island draws is one a legend entry names, and every entry's marks are drawn", () => {
  const drawn = drawnNames(drawnIsland());
  const listed = new Set(MAP_LEGEND.flatMap(({ draws }) => draws));
  for (const name of drawn) assert.ok(listed.has(name), `the legend names ${name}`);
  for (const { words, draws, at } of MAP_LEGEND) {
    if (at === "sea") continue;
    assert.ok(draws.length > 0 && draws.every((name) => drawn.has(name)), `the map draws what "${words}" says`);
  }
});

test("4.39 the legend's fills are the territories' fills by word, parked, mapped and uncharted, each drawn", () => {
  const fills = new Set<string>();
  drawnIsland().traverse((object) => {
    if (object instanceof Mesh && /^territory:/.test(object.name)) fills.add(`#${(object.material as MeshBasicMaterial).color.getHexString()}`);
  });
  const swatches = new Set(MAP_LEGEND.flatMap(({ fill }) => fill === undefined ? [] : [`#${new Color(fill).getHexString()}`]));
  assert.deepEqual([...swatches].sort(), [...fills].sort());
});

test("4.39 the legend shows each of the six settlement kinds, the sea lanes as dots at rest and a pale fill under a selection, in the story panel", () => {
  const html = renderMapLegend();
  for (const [kind, { parts, lines }] of Object.entries(GLYPHS)) {
    const mark = new RegExp(`data-kind="${kind}">(<svg[\\s\\S]*?</svg>)`).exec(html)?.[1] ?? "";
    // As the island draws it: each closed shape filled with paper, each line an open stroke over them.
    const paths = [...mark.matchAll(/<path d="([^"]*)" fill="([^"]*)"/g)].map(([, d, fill]) => ({ closed: d!.endsWith("Z"), filled: fill !== "none" }));
    assert.equal(paths.filter(({ closed, filled }) => closed && filled).length, parts.length, `the ${kind} symbol's shapes`);
    assert.equal(paths.filter(({ closed, filled }) => !closed && !filled).length, lines.length, `the ${kind} symbol's lines`);
  }
  const lane = MAP_LEGEND.find(({ at, draws }) => at === "sea" && draws.includes("lane"));
  assert.ok(lane && lane.draws.includes("lane-dots") && lane.mark.includes(SEA_LANE) && lane.mark.includes(SEA_LANE_FILL), "the lane's dots at rest and its fill under a selection, each in its colour");
  const panel = renderStoryPanel({ id: "s", title: "S", description: "d", capabilities: [] } as unknown as Parameters<typeof renderStoryPanel>[0], undefined);
  assert.ok(panel.includes(html), "the panel carries the legend");
});
