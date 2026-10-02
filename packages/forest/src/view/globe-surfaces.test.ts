import assert from "node:assert/strict";
import test from "node:test";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { presentTerritories, restoreTerritoryPresentation } from "./globe-surfaces.js";
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
