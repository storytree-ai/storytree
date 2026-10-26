/** 1.10 on a first real build's size: a five-story forest, in a row and in a chain, opens on the glass sheet with every story's nameplate readable. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Group, PerspectiveCamera, Vector3 } from "three";

import { workStates } from "@storytree/arc-surface";
import { buildPlanetPathways, plateTransform } from "@storytree/forest-world/geometry";
import { applySheetEye, onIslandSurface, SHEET_FOV, SHEET_LAND_LIFT, SHEET_RADIUS, SHEET_TILT, SHIPPED_ELEVATION_DEG } from "@storytree/forest-world/planet";
import { forestScene, storyNodes } from "@storytree/forest";

import { focusRotation } from "./planet-navigation.js";
import { sheetLayout, sheetOpening, sheetTilted } from "./sheet-navigation.js";
import { facing, fadedPlates, southOnPlate, STORY_PLATE_WIDTH, storyPlate, type ShownPlate } from "./nameplates.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
// A first build's stories, as the Conduit builds named them: one capability each.
const titles = ["Have an account", "Comment on articles", "Browse the home page feed", "Read and write articles", "Follow people and favourite articles"];

/** A forest of the five stories: none depending on another (one row), or each on the one before (a chain). */
function forest(chain: boolean) {
  const ids = titles.map((_, i) => `story_${i}`);
  return { arcs: [], stories: ids.map((id, i) => ({ id, title: titles[i]!, health, capabilities: [{
    id: `${id}-0`, title: "Capability", dependsOn: chain && i > 0 ? [`${ids[i - 1]}-0`] : [], proposed: true, status: "proposed" as const, contracts: [], health,
  }] })) };
}

/**
 * A story nameplate's box as the desktop draws it (`.forest-label`: 0.82rem semibold, 0.1rem by 0.55rem of padding),
 * its title wrapped by word to the plate's width, at an estimated 7.2 px a character and 15.5 px a line, and a first
 * build's progress ("0 / 1 landed" over its meter, 58 px wide, 22 px tall) beneath it.
 */
function plateSize(title: string): { width: number; height: number } {
  const room = Math.max(1, Math.floor((STORY_PLATE_WIDTH - 17.6) / 7.2));
  const lines: string[] = [];
  for (const word of title.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= room) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return { width: Math.max(58, ...lines.map(line => line.length * 7.2)) + 17.6, height: lines.length * 15.5 + 22 + 3.2 };
}

/** Each story's nameplate on screen as the app opens the glass sheet in a window `width` by `height` (the canvas below its
 * header), measured as the view measures it: the perspective eye at the sheet's opening, tilted to its resting view. */
function opening(chain: boolean, width = 1440, height = 840): ShownPlate[] {
  const tree = forest(chain), size = { width, height };
  const places = new Map(storyNodes(tree, []).map(({ id, place }) => [id, place]));
  const scene = forestScene(tree, [], workStates([]));
  const layout = sheetLayout(scene, places);
  const plates = buildPlanetPathways(scene, layout.spots, layout.radius).plates;
  const pose = sheetOpening(layout.extent, size);
  const camera = new PerspectiveCamera(SHEET_FOV, width / height, 0.1, 1000);
  const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
  camera.position.set(0, Math.sin(elevation), Math.cos(elevation));
  camera.lookAt(0, 0, 0);
  applySheetEye(camera, Math.hypot(layout.extent.width, layout.extent.height), Math.min(width, height) / (2 * pose.framing * SHEET_RADIUS), size);
  camera.updateMatrixWorld();
  const turned = sheetTilted(focusRotation(pose.turn, camera.quaternion), camera.quaternion, SHEET_TILT);
  const globe = new Group();
  globe.quaternion.copy(turned.quaternion);
  globe.position.copy(turned.position);
  globe.updateMatrixWorld();
  const surface = onIslandSurface(layout.radius, 2);
  return scene.islands.map(island => {
    const { position, quaternion } = plateTransform(layout.spots.get(island.story)!, layout.radius, SHEET_LAND_LIFT);
    const at = surface(storyPlate(plates.get(island.story)!.coast, southOnPlate(quaternion)))
      .applyQuaternion(quaternion).add(new Vector3(...position)).applyMatrix4(globe.matrixWorld).project(camera);
    const size = plateSize(island.title), x = (at.x + 1) * width / 2, y = (1 - at.y) * height / 2;
    return { story: island.title, box: { left: x - size.width / 2, right: x + size.width / 2, top: y, bottom: y + size.height }, facing: facing(globe.quaternion.clone().multiply(quaternion), camera.quaternion) };
  });
}

test("1.10 a five-story forest, in a row and in a chain, opens on the glass sheet with every story's nameplate readable: none faded, none overlapping", () => {
  for (const [shape, chain] of [["row", false], ["chain", true]] as const) {
    const plates = opening(chain);
    assert.deepEqual([...fadedPlates(plates)], [], `${shape}: no plate fades`);
    for (const [i, { story, box }] of plates.entries()) for (const other of plates.slice(i + 1)) {
      const overlap = box.left < other.box.right && other.box.left < box.right && box.top < other.box.bottom && other.box.top < box.bottom;
      assert.ok(!overlap, `${shape}: ${story}'s plate overlaps ${other.story}'s`);
    }
  }
});
