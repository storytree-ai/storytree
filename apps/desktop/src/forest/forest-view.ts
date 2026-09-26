/**
 * The forest's 3D picture (stories/forest.md, capability 3 · Story node render): it turns
 * @storytree/forest's plan (forestScene) into meshes, and does nothing the plan does not say. Every
 * story node is a low-poly island on a calm sea carrying its grove, lit by one warm light, with its
 * story's name floating over it. It can be panned, zoomed and turned, and a click on an island
 * selects it.
 *
 * The look is 0.2's land look, ported as it stands with no art research (ADR-0625 D4, ADR-0508):
 * the trees are the bought pine kit's own meshes, from the export 0.2 shipped (dressing-kit.glb,
 * sha256 9479bc81…; only that exported output ships, never the kit itself, ADR-0418's rule). The
 * leaf tint for a tree still growing is 0.2's building token, laid over the needles at their own
 * brightness as 0.2's leaf-tint did. The look is judged by the owner's eye.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import { changedIslands, type ForestScene, type Island, type Marker, type PlacedTree } from "@storytree/forest";

import kitBytes from "@storytree/forest-world/assets/dressing-kit.glb";

/** How tall a full tree stands, in world units. */
const TREE_HEIGHT = 5.6;
/** The island's grass top sits this high above the sea. */
const LAND_TOP = 0.7;

const COLOURS = {
  sky: 0x101418, // 0.2's backdrop
  sea: 0x2f5d73,
  sand: 0xcdb98a,
  grass: 0x8cb85e, // 0.2's healthy land token
  rock: 0x7d7465,
  sun: 0xffe2b8,
  selected: 0xffd75e,
};

/** 0.2's leaf tint tokens (leaf-tint.ts): a tree still growing wears the building token, and a landed tree nobody has reported on a washed, pale one. */
const LEAF_TINT = { seedling: "#d8c069", pale: "#c9c7a6" } as const;

export interface ForestView {
  /** Draw `scene`, rebuilding only the islands that changed since the last one. */
  show(scene: ForestScene): void;
  /** Show which agent holds which capability, each marker over its tree (capability 5). */
  showMarkers(markers: readonly Marker[]): void;
  /** Mark `story` selected (undefined for none), as a click would. */
  select(story: string | undefined): void;
  /** Stop drawing and let go of the GPU. */
  dispose(): void;
}

/** A tree mesh to copy: the kit's pine, stood upright at the origin with its base at 0. */
interface Templates {
  pines: THREE.Object3D[];
  dead: THREE.Object3D;
  leaves: THREE.MeshStandardMaterial;
  tinted: Map<string, THREE.MeshStandardMaterial>;
}

/** Open the forest in `container`. `onSelect` hears which story a click picked (undefined for the sea). */
export async function openForestView(container: HTMLElement, onSelect: (story: string | undefined) => void): Promise<ForestView> {
  const templates = await loadKit();

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = "forest-labels";
  container.append(labels.domElement);

  const scene3d = new THREE.Scene();
  scene3d.background = new THREE.Color(COLOURS.sky);
  scene3d.fog = new THREE.Fog(COLOURS.sky, 160, 420);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.minDistance = 8;
  controls.maxDistance = 400;

  scene3d.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 0.9));
  const sun = new THREE.DirectionalLight(COLOURS.sun, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  scene3d.add(sun, sun.target);

  const sea = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.MeshStandardMaterial({ color: COLOURS.sea, roughness: 0.35, metalness: 0.05 }));
  sea.rotation.x = -Math.PI / 2;
  sea.receiveShadow = true;
  scene3d.add(sea);

  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), new THREE.MeshBasicMaterial({ color: COLOURS.selected, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene3d.add(ring);

  const groups = new Map<string, THREE.Group>();
  const markerGroup = new THREE.Group();
  scene3d.add(markerGroup);
  let markers: readonly Marker[] = [];

  function showMarkers(next: readonly Marker[]): void {
    markers = next;
    for (const old of [...markerGroup.children]) {
      markerGroup.remove(old);
      if (old instanceof CSS2DObject) old.element.remove();
    }
    const trees = new Map(current.islands.flatMap((island) => island.trees.map((tree) => [tree.capability, tree] as const)));
    for (const marker of next) {
      const tree = trees.get(marker.capability);
      if (tree === undefined) continue;
      const pill = document.createElement("div");
      pill.className = `forest-claim${marker.faded ? " faded" : ""}${marker.hooksNotRunning ? " no-hooks" : ""}`;
      pill.textContent = marker.hooksNotRunning ? `${marker.text} · hooks not running` : marker.text;
      pill.dataset.capabilityId = marker.capability;
      pill.title = marker.faded ? "quiet past the quiet time: it still holds this capability" : "";
      const label = new CSS2DObject(pill);
      label.position.set(tree.x, LAND_TOP + TREE_HEIGHT * tree.scale + 0.8, tree.z);
      markerGroup.add(label);
    }
  }
  let current: ForestScene = { islands: [] };
  let selected: string | undefined;
  let framed = false;

  function show(next: ForestScene): void {
    for (const story of changedIslands(current, next)) {
      const old = groups.get(story);
      if (old !== undefined) {
        scene3d.remove(old);
        disposeGroup(old);
        groups.delete(story);
      }
      const island = next.islands.find((candidate) => candidate.story === story);
      if (island !== undefined) {
        const group = drawIsland(island, templates);
        groups.set(story, group);
        scene3d.add(group);
      }
    }
    current = next;
    showMarkers(markers);
    if (!framed && next.islands.length > 0) {
      frame(next);
      framed = true;
    }
    select(selected);
  }

  /** Put the camera where the whole forest is in view, looking down on it at an angle, and the sun's shadows over all of it. */
  function frame(scene: ForestScene): void {
    const count = scene.islands.length;
    const centre = new THREE.Vector3(scene.islands.reduce((sum, { x }) => sum + x, 0) / count, LAND_TOP, scene.islands.reduce((sum, { z }) => sum + z, 0) / count);
    const reach = Math.max(10, ...scene.islands.map((island) => Math.hypot(island.x - centre.x, island.z - centre.z) + island.radius));
    const distance = (reach * 1.05) / Math.sin((camera.fov * Math.PI) / 360);
    const direction = new THREE.Vector3(0.45, 0.78, 0.62).normalize();
    camera.position.copy(centre).addScaledVector(direction, distance);
    controls.target.copy(centre);
    controls.update();
    sun.position.set(centre.x + reach * 0.9, reach * 1.6, centre.z + reach * 0.5);
    sun.target.position.copy(centre);
    const shadow = sun.shadow.camera;
    shadow.left = shadow.bottom = -reach - 8;
    shadow.right = shadow.top = reach + 8;
    shadow.far = reach * 5;
    shadow.updateProjectionMatrix();
  }

  function select(story: string | undefined): void {
    selected = story;
    const island = current.islands.find((candidate) => candidate.story === story);
    ring.visible = island !== undefined;
    if (island !== undefined) {
      ring.position.set(island.x, LAND_TOP + 0.05, island.z);
      ring.scale.setScalar(island.radius + 0.4);
    }
    for (const [id, group] of groups) group.userData.label?.element.classList.toggle("selected", id === story);
  }

  // A click, not a drag: the island under the pointer, found where the ray meets the land's top.
  let down: { x: number; y: number } | undefined;
  renderer.domElement.addEventListener("pointerdown", (event) => (down = { x: event.clientX, y: event.clientY }));
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (down === undefined || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const box = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1), camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -LAND_TOP), new THREE.Vector3());
    const story = hit === null ? undefined : current.islands.find((island) => Math.hypot(hit.x - island.x, hit.z - island.z) <= island.radius)?.story;
    select(story);
    onSelect(story);
  });

  const resize = (): void => {
    const { clientWidth: width, clientHeight: height } = container;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    labels.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let running = true;
  const draw = (): void => {
    if (!running) return;
    controls.update();
    renderer.render(scene3d, camera);
    labels.render(scene3d, camera);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  return {
    show,
    showMarkers,
    select,
    dispose() {
      running = false;
      observer.disconnect();
      controls.dispose();
      for (const group of groups.values()) disposeGroup(group);
      renderer.dispose();
      container.replaceChildren();
    },
  };
}

/** One island: a low-poly shelf of sand and grass, its grove, and its name. */
function drawIsland(island: Island, templates: Templates): THREE.Group {
  const group = new THREE.Group();
  const sides = Math.max(7, Math.round(island.radius * 2.2));
  const sand = new THREE.Mesh(roughCylinder(island.radius + 0.9, island.radius + 1.6, LAND_TOP * 0.7, sides, island.story), flat(COLOURS.sand));
  sand.position.set(island.x, (LAND_TOP * 0.7) / 2 - 0.25, island.z);
  const grass = new THREE.Mesh(roughCylinder(island.radius, island.radius + 0.7, LAND_TOP * 0.6, sides, `${island.story}~`), flat(COLOURS.grass));
  grass.position.set(island.x, LAND_TOP - (LAND_TOP * 0.6) / 2, island.z);
  for (const land of [sand, grass]) {
    land.receiveShadow = true;
    land.castShadow = true;
    land.userData.own = true; // the island's own, freed with it; the kit's meshes are shared and kept
  }
  group.add(sand, grass);

  island.trees.forEach((tree, index) => group.add(drawTree(tree, index, templates)));

  const name = document.createElement("div");
  name.className = "forest-label";
  name.textContent = island.title;
  name.dataset.storyId = island.story;
  const label = new CSS2DObject(name);
  label.position.set(island.x, LAND_TOP + TREE_HEIGHT + 1.4, island.z);
  group.add(label);
  group.userData.label = label;
  return group;
}

/** One tree: the kit's pine at its form's size and tint, or its bare dead trunk. */
function drawTree(tree: PlacedTree, index: number, templates: Templates): THREE.Object3D {
  const template = tree.form === "dead" ? templates.dead : (templates.pines[index % templates.pines.length] ?? templates.dead);
  const copy = template.clone(true);
  const tint = tree.form === "seedling" || tree.form === "pale" ? LEAF_TINT[tree.form] : undefined;
  copy.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (tint !== undefined && node.material === templates.leaves) node.material = tintedLeaves(templates, tint);
  });
  copy.scale.multiplyScalar(tree.scale);
  copy.rotation.y = tree.turn;
  copy.position.set(tree.x, LAND_TOP - 0.05, tree.z);
  copy.userData.capability = tree.capability;
  return copy;
}

/** Load the exported kit and stand its pines up as templates, each TREE_HEIGHT tall with its base at the origin. */
async function loadKit(): Promise<Templates> {
  const buffer = kitBytes.buffer.slice(kitBytes.byteOffset, kitBytes.byteOffset + kitBytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  const byName = (name: string): THREE.Object3D => {
    const found = gltf.scene.getObjectByName(name);
    if (found === undefined) throw new Error(`the pine kit has no ${name}`);
    return found;
  };
  const assemble = (...names: string[]): THREE.Object3D => {
    const group = new THREE.Group();
    for (const name of names) group.add(byName(name).clone(true));
    const box = new THREE.Box3().setFromObject(group);
    const centre = box.getCenter(new THREE.Vector3());
    for (const child of group.children) child.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
    const holder = new THREE.Group();
    holder.add(group);
    holder.scale.setScalar(TREE_HEIGHT / Math.max(0.001, box.max.y - box.min.y));
    return holder;
  };
  let leaves: THREE.MeshStandardMaterial | undefined;
  byName("Pine_Leaves_01").traverse((node) => {
    if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) leaves = node.material;
  });
  if (leaves === undefined) throw new Error("the pine kit's leaves have no material");
  return { pines: [assemble("Pine_Trunk_01", "Pine_Leaves_01"), assemble("Pine_Trunk_04", "Pine_Leaves_04")], dead: assemble("Pine_Trunk_No_Leaves_01"), leaves, tinted: new Map() };
}

/**
 * The needles in `token`'s colour at their own brightness, as 0.2's leaf-tint did: a gain per
 * channel that turns the needle map's average colour into the token's hue, keeping its lightness.
 */
function tintedLeaves(templates: Templates, token: string): THREE.MeshStandardMaterial {
  const known = templates.tinted.get(token);
  if (known !== undefined) return known;
  const mean = mapMean(templates.leaves.map) ?? new THREE.Color(0.25, 0.35, 0.2);
  const want = new THREE.Color(token);
  const luma = (colour: THREE.Color): number => 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
  const scale = luma(mean) / Math.max(0.0001, luma(want));
  const material = templates.leaves.clone();
  material.color.setRGB(
    (want.r * scale) / Math.max(0.02, mean.r),
    (want.g * scale) / Math.max(0.02, mean.g),
    (want.b * scale) / Math.max(0.02, mean.b),
  );
  templates.tinted.set(token, material);
  return material;
}

/** The average colour of a texture's image, or undefined if it cannot be read. */
function mapMean(map: THREE.Texture | null): THREE.Color | undefined {
  const image = map?.image as CanvasImageSource | undefined;
  if (image === undefined) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return undefined;
  context.drawImage(image, 0, 0, 16, 16);
  const { data } = context.getImageData(0, 0, 16, 16);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if ((data[index + 3] ?? 0) < 128) continue; // cut-out gaps between needles are not needles
    r += data[index] ?? 0;
    g += data[index + 1] ?? 0;
    b += data[index + 2] ?? 0;
    count++;
  }
  if (count === 0) return undefined;
  return new THREE.Color().setRGB(r / count / 255, g / count / 255, b / count / 255, THREE.SRGBColorSpace);
}

/** A cylinder whose rim is nudged in and out, the same way every time for the same seed, so an island is low-poly rather than a machined disc. */
function roughCylinder(top: number, bottom: number, height: number, sides: number, seed: string): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, sides, 1);
  const position = geometry.getAttribute("position");
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const angle = Math.atan2(z, x);
    const nudge = 1 + 0.09 * Math.sin(angle * 3 + (hash % 97)) + 0.05 * Math.sin(angle * 7 + (hash % 31));
    position.setX(index, x * nudge);
    position.setZ(index, z * nudge);
  }
  geometry.computeVertexNormals();
  return geometry.toNonIndexed();
}

function flat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 });
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((node) => {
    if (node instanceof THREE.Mesh && node.userData.own === true) {
      node.geometry.dispose();
      (node.material as THREE.Material).dispose();
    }
    if (node instanceof CSS2DObject) node.element.remove();
  });
}
