import assert from "node:assert/strict";
import test from "node:test";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { growLand, PAST_ISLANDS, pastIslands, presentTerritories, restoreTerritoryPresentation, shownSurfaces, type GlobeSurfaces } from "./globe-surfaces.js";
import { fileCircleMarks } from "./file-circles.js";
import { territoryLand } from "./territory-land.js";

test("3.22 territories switch between health, plain boundaries and hidden without changing claims or geometry", () => {
  const land = territoryLand({ territories: [{ capability: "pay", status: "unhealthy" }],
    cells: [{ territory: 0, polygon: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }] }],
    borders: [{ from: { x: 0, z: 0 }, to: { x: 0, z: 2 } }] }, p => new Vector3(p.x, 0, p.z), undefined,
    new Map([["pay", { colour: "#aa66ff", faded: false }]]));
  const territory = land.getObjectByName("territory:pay") as Mesh;
  const material = territory.material as MeshBasicMaterial, opacity = material.opacity;
  const geometry = territory.geometry, colour = material.color.clone();
  const border = land.getObjectByName("territory-borders")!, claim = land.getObjectByName("territory-claim:pay")!;
  presentTerritories(land, "plain");
  assert.equal(material.opacity, 0, "plain boundaries have no health fill");
  assert.ok(border.visible && claim.visible);
  presentTerritories(land, false);
  assert.ok(!territory.visible && !border.visible && claim.visible, "claims have their own switch");
  presentTerritories(land, "health");
  assert.ok(territory.visible && border.visible); assert.equal(material.opacity, opacity); assert.ok(material.color.equals(colour));
  assert.equal(territory.geometry, geometry);
  presentTerritories(land, "plain");
  territory.material = material.clone(); // Session emphasis owns a temporary material copy.
  presentTerritories(land, "health");
  assert.equal((territory.material as MeshBasicMaterial).opacity, opacity, "health survives a plain-mode material copy");
  material.opacity = opacity;
  presentTerritories(land, "plain");
  territory.material = material; // Emphasis cleanup restores its original.
  restoreTerritoryPresentation(land);
  assert.equal(material.opacity, 0, "cleanup cannot restore a stale health fill over a plain view");
});

test("3.30 on a growing globe each territory fills in and each file circle swells as the growth schedules them, ending as drawn without one", () => {
  const land = territoryLand({ territories: [{ capability: "pay", status: "healthy" }, { capability: "ship", status: "unhealthy" }],
    cells: [{ territory: 0, polygon: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }] }, { territory: 1, polygon: [{ x: 0, z: 0 }, { x: -2, z: 0 }, { x: -2, z: 2 }] }],
    borders: [] }, p => new Vector3(p.x, 0, p.z));
  const circles = fileCircleMarks([{ path: "src/pay.ts", lines: 40, x: 1, z: 1, radius: 0.5, capability: "pay" }],
    p => new Vector3(p.x, 0, p.z), () => new Vector3(0, 1, 0));
  const [pay, ship] = ["pay", "ship"].map(c => land.getObjectByName(`territory:${c}`) as Mesh);
  const circle = circles.getObjectByName("file:src/pay.ts")!;
  const full = [pay, ship].map(t => (t!.material as MeshBasicMaterial).opacity);
  presentTerritories(land, "health");
  const at = (progress: Record<string, number>) => growLand(land, circles, { capability: c => progress[c] ?? 1, file: path => progress[path] ?? 1 });
  at({ pay: 0, ship: 0, "src/pay.ts": 0 });
  assert.ok(!pay!.visible && !ship!.visible && !circle.visible, "nothing before its window");
  at({ pay: 0.5, ship: 0, "src/pay.ts": 0.5 });
  assert.ok(pay!.visible && !ship!.visible, "each capability on its own window");
  assert.equal((pay!.material as MeshBasicMaterial).opacity, full[0]! * 0.5);
  assert.ok(circle.visible); assert.equal(circle.scale.x, 0.25, "a circle swells from its middle");
  // The territory switches hold while it grows: plain has no fill, hidden stays hidden.
  presentTerritories(land, "plain");
  assert.equal((pay!.material as MeshBasicMaterial).opacity, 0);
  presentTerritories(land, false);
  at({ pay: 0.8 });
  assert.ok(!pay!.visible, "a hidden territory does not grow back into view");
  presentTerritories(land, "health");
  at({});
  assert.deepEqual([pay, ship].map(t => [t!.visible, (t!.material as MeshBasicMaterial).opacity]), [[true, full[0]], [true, full[1]]], "whole, as drawn without growth");
  assert.ok(circle.visible); assert.equal(circle.scale.x, 0.5);
});

const islandMarks = (surfaces: GlobeSurfaces) =>
  [surfaces.grounds, surfaces.roads, surfaces.nameplates, surfaces.territories, surfaces.fileCircles, surfaces.sessionTints];

test("3.9 Library hides the islands and every mark on them, and keeps the glass and the core", () => {
  const forest = shownSurfaces(undefined, false);
  assert.deepEqual(islandMarks(forest), [true, true, true, "health", true, true], "the ordinary Forest view");
  const library = shownSurfaces(undefined, true);
  assert.deepEqual(islandMarks(library), [false, false, false, false, false, false]);
  assert.deepEqual([library.sea, library.knowledgeCore], [true, true], "the globe stays, with the core inside it (ADR-0919 D4)");
  // A guide's own switches still apply to what stays.
  assert.equal(shownSurfaces({ sea: false }, true).sea, false);
});

test("3.34 zooming in past the islands hides them, leaving the glass and core; zooming back out brings them back without flickering", () => {
  // Framing is how many radii half the screen's short side spans: smaller is closer in.
  assert.equal(pastIslands(1.18, false), false, "the opening view");
  assert.equal(pastIslands(0.2, false), false, "close on an island, reading its file circles");
  assert.equal(pastIslands(0.55, false), false, "the closest a guided stop frames");
  let past = false;
  const zoom = (framing: number) => (past = pastIslands(framing, past));
  assert.equal(zoom(PAST_ISLANDS.enter * 0.99), true, "past the islands");
  // Hovering at the edge does not toggle them: they come back only once clearly out again.
  assert.equal(zoom(PAST_ISLANDS.enter * 1.01), true);
  assert.ok(PAST_ISLANDS.leave > PAST_ISLANDS.enter);
  assert.equal(zoom(PAST_ISLANDS.leave * 1.01), false, "back out, the islands return");
  assert.equal(zoom(PAST_ISLANDS.enter * 1.01), false);
  assert.deepEqual(shownSurfaces(undefined, past), shownSurfaces(undefined, false));
});
