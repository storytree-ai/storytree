/** 1.10 on a first real build's size: a five-story forest, in a row and in a chain, opens with every story's nameplate readable. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Quaternion, Vector3 } from "three";

import { workStates } from "@storytree/arc-surface";
import { buildPlanetPathways, plateTransform } from "@storytree/forest-world/geometry";
import { onIslandSurface } from "@storytree/forest-world/planet";
import { forestScene, openingTurn, storyNodes } from "@storytree/forest";

import { focusRotation, globeFraming, planetLayout } from "./planet-navigation.js";
import { facing, screenOnPlate, settlePlates, STORY_PLATE_WIDTH, storyPlate, type ShownPlate } from "./nameplates.js";

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
 * its title wrapped by word to the plate's width, at an estimated 7.2 px a character and 15.5 px a line.
 */
function plateSize(title: string): { width: number; height: number } {
  const room = Math.max(1, Math.floor((STORY_PLATE_WIDTH - 17.6) / 7.2));
  const lines: string[] = [];
  for (const word of title.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= room) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return { width: Math.max(...lines.map(line => line.length)) * 7.2 + 17.6, height: lines.length * 15.5 + 3.2 };
}

/** Each story's nameplate on screen as the app opens a window `width` by `height` (the canvas below its header), measured as the view measures it. */
function opening(chain: boolean, width = 1440, height = 840): ShownPlate[] {
  const tree = forest(chain);
  const places = new Map(storyNodes(tree, []).map(({ id, place }) => [id, place]));
  const scene = forestScene(tree, [], workStates([]));
  const layout = planetLayout(scene, places);
  const plates = buildPlanetPathways(scene, layout.spots, layout.radius).plates;
  // The globe is turned by the eye before its own turn, so north stays up whatever the eye's elevation: an unturned eye sees the same.
  const eye = new Quaternion();
  const rotation = focusRotation(openingTurn(layout.islands), eye);
  const zoom = Math.min(width, height) / (2 * layout.radius * globeFraming("whole"));
  const surface = onIslandSurface(layout.radius, 2);
  return scene.islands.map(island => {
    const { position, quaternion } = plateTransform(layout.spots.get(island.story)!, layout.radius);
    const turned = rotation.clone().multiply(quaternion);
    const at = surface(storyPlate(plates.get(island.story)!.coast, screenOnPlate(turned, eye), layout.radius * 0.9))
      .applyQuaternion(quaternion).add(new Vector3(...position)).applyQuaternion(rotation);
    const size = plateSize(island.title), x = width / 2 + zoom * at.x, y = height / 2 - zoom * at.y;
    return { story: island.title, box: { left: x - size.width / 2, right: x + size.width / 2, top: y, bottom: y + size.height }, facing: facing(turned, eye) };
  });
}

test("1.10 a five-story forest, in a row and in a chain, opens with every story's nameplate readable: none hidden, none overlapping, every island facing the eye at least half on", () => {
  for (const [shape, chain] of [["row", false], ["chain", true]] as const) {
    const plates = opening(chain);
    const { drops, hidden } = settlePlates(plates);
    assert.deepEqual([...hidden], [], `${shape}: no plate is hidden`);
    const shown = plates.map(({ story, box }) => {
      const drop = drops.get(story) ?? 0;
      return { story, box: { ...box, top: box.top + drop, bottom: box.bottom + drop } };
    });
    for (const [i, { story, box }] of shown.entries()) for (const other of shown.slice(i + 1)) {
      const overlap = box.left < other.box.right && other.box.left < box.right && box.top < other.box.bottom && other.box.top < box.bottom;
      assert.ok(!overlap, `${shape}: ${story}'s plate overlaps ${other.story}'s`);
    }
    for (const { story, facing } of plates) assert.ok(facing >= 0.5, `${shape}: ${story}'s island faces the eye at ${facing.toFixed(2)}, squeezed toward the rim`);
  }
});
