/** Capability 3 · Story node render. The desktop's joins between the sheet's islands, the pointer, and Three's camera. */
import { Box3, Euler, Quaternion, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import type { FacingIsland, GlobeTurn } from "@storytree/forest";
import { pickProjectedNote, type ProjectedNote } from "./globe-picking.js";
import type { Selection } from "./panel-selection.js";
import type { GlobeOpening } from "../surfaces/surfaces.js";
import { isDrawn } from "./globe-guide.js";
import { globeName } from "./nameplates.js";
import { gateOf, type GatePick } from "./island-roads.js";

export type ForestMode = "forest" | "library";

/** Five CSS pixels or more separates a drag from a click (3.12). */
export function isGlobeDrag(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= 5;
}

/**
 * The cursor and tooltip for the actual eligible artifact or capability territory beneath the pointer
 * (3.12): a territory gives its capability's name, without its number, and its description's first paragraph as the detail (3.32).
 */
export function globeHover(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }, mode: ForestMode): { cursor: string; title: string | undefined; detail?: string } {
  const hit = pickGlobe(world, camera, box, cursor, mode);
  const pointer = hit === undefined ? "" : "pointer";
  if (hit?.kind === "note") return { cursor: pointer, title: world.getObjectByName(`knowledge-point:${hit.id}`)?.userData.title as string | undefined };
  const territory = (capability: string) => world.getObjectByName(`territory:${capability}`)?.userData as { title?: string; description?: string } | undefined;
  if (hit?.kind !== "story" || hit.capability === undefined) return { cursor: pointer, title: undefined };
  const { title, description } = territory(hit.capability) ?? {};
  // What the capability does is its description's first paragraph; later ones are notes for the agents who build it.
  const detail = description?.trim().split(/\r?\n\s*\r?\n/)[0]?.trim();
  return { cursor: pointer, title: globeName(title ?? hit.capability), ...(detail === undefined || detail === "" ? {} : { detail }) };
}

/**
 * How many radii half the window's short side spans as the globe opens (ADR-0750): 1.18 for the
 * whole planet, so it fills 85% of the short side as it always has; less close up, more with room around.
 */
export function globeFraming(choice: GlobeOpening): number {
  return choice === "close" ? 0.8 : choice === "far" ? 1.7 : 1.18;
}

/** How long a host's change of layout takes to move its islands, in seconds (3.28). */
export const MOVE_SECONDS = 1.6;

/**
 * The spots on show `progress` (0 to 1) of the way through a change of layout from `from` to `to` (3.28): an island in both
 * slides along the globe from its old spot to its new, eased in and out; an island new to `to` stands at its spot.
 */
export function movingSpots(from: ReadonlyMap<string, FacingIsland["spot"]>, to: ReadonlyMap<string, FacingIsland["spot"]>, progress: number): Map<string, FacingIsland["spot"]> {
  if (progress >= 1) return new Map(to);
  const eased = progress <= 0 ? 0 : progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
  return new Map([...to].map(([story, end]) => {
    const start = from.get(story);
    if (start === undefined) return [story, end];
    if (eased === 0) return [story, start];
    const angle = Math.acos(Math.max(-1, Math.min(1, start.x * end.x + start.y * end.y + start.z * end.z)));
    if (angle < 1e-9) return [story, end];
    const a = Math.sin((1 - eased) * angle) / Math.sin(angle), b = Math.sin(eased * angle) / Math.sin(angle);
    return [story, { x: a * start.x + b * end.x, y: a * start.y + b * end.y, z: a * start.z + b * end.z }];
  }));
}

/**
 * The big sphere the sheet is the near pole of, as turned in the eye's frame: spun about its poles by yaw, then tilted by
 * pitch. A sheet's turns are a hair's breadth, so with an eye that never rolls, north points straight up the screen.
 */
export function focusRotation(turn: GlobeTurn, eye: Quaternion): Quaternion {
  return eye.clone().multiply(new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0)));
}

/** 3.11: where an edge marker sits in a canvas `size`, in its pixels: at its spot, kept 20px inside the canvas. */
export function markerSpot(at: { left: number; top: number }, size: { width: number; height: number }): { left: number; top: number } {
  return { left: Math.max(20, Math.min(size.width - 20, at.left)), top: Math.max(20, Math.min(size.height - 20, at.top)) };
}

/** Edge markers' room on screen, in CSS px: one 32px marker and a gap. */
const MARKER_ROOM = 36;

/**
 * 3.89: edge markers `spots` (each placed by `markerSpot`) moved along their edge, in order, until none lies within
 * MARKER_ROOM of one before it, so two that lie the same way stay apart, each clickable, and still on the canvas `size`.
 */
export function markersApart<T extends { left: number; top: number }>(spots: readonly T[], size: { width: number; height: number }): T[] {
  const placed: T[] = [];
  for (const spot of spots) {
    const along = spot.top <= 20 || spot.top >= size.height - 20 ? "left" : "top";
    const end = (along === "left" ? size.width : size.height) - 20;
    let at = { ...spot };
    for (let tries = 0; tries < 64 && placed.some(p => Math.abs(p.left - at.left) < MARKER_ROOM && Math.abs(p.top - at.top) < MARKER_ROOM); tries++) {
      const next = at[along] + MARKER_ROOM;
      at = { ...at, [along]: next > end ? 20 + (next - end) % MARKER_ROOM : next };
    }
    placed.push(at);
  }
  return placed;
}

/** Pick the actual turned land. */
export function pickIsland(ray: Raycaster, world: Object3D): string | undefined {
  return pickLand(ray, world)?.story;
}

/** The land a ray meets first: its story, and the capability whose territory it is, if it is one (3.15). */
function pickLand(ray: Raycaster, world: Object3D): { story: string; capability?: string } | undefined {
  for (const hit of ray.intersectObject(world, true)) {
    if (!isDrawn(hit.object)) continue;
    let capability: string | undefined;
    for (let object: Object3D | null = hit.object; object !== null; object = object.parent) {
      if (object.name.startsWith("territory:") && typeof object.userData.capability === "string") capability ??= object.userData.capability;
      if (object.name.startsWith("planet:")) return capability === undefined ? { story: object.name.slice("planet:".length) } : { story: object.name.slice("planet:".length), capability };
    }
  }
  return undefined;
}

/** A gate picked on an island: the island's story, and the gate (3.88). */
export type PickedGate = { readonly story: string; readonly pick: GatePick };

/**
 * The gate on an island's land under the pointer (3.88): when it is the first of the land's marks the ray meets, so land
 * standing before it hides it; or, when that first mark is the island's land round it, the ringed gate whose ring the pointer
 * is inside, the nearest first, while its posts are drawn, so a gate whose posts are a few pixels across is still picked
 * by its ring. Roads take no ray, so one never stands in its way, and beside a gate no ring marks the land is picked (3.15).
 */
export function pickGate(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }): PickedGate | undefined {
  world.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(2 * (cursor.x - box.left) / box.width - 1, 1 - 2 * (cursor.y - box.top) / box.height), camera);
  for (const hit of ray.intersectObject(world, true)) {
    if (!isDrawn(hit.object)) continue;
    let story: string | undefined;
    for (let object: Object3D | null = hit.object; object !== null && story === undefined; object = object.parent) {
      if (object.name.startsWith("planet:")) story = object.name.slice("planet:".length);
    }
    if (story === undefined) continue;
    const pick = gateOf(hit.object) ?? ringedGate(hit.object, ray);
    return pick === undefined ? undefined : { story, pick };
  }
  return undefined;
}

/** The ringed gate on the island of `land` whose ring, as drawn, `ray` passes inside, the nearest its centre first, while
 * the gate's posts are drawn; none if it passes inside no ring. */
function ringedGate(land: Object3D, ray: Raycaster): GatePick | undefined {
  let planet: Object3D | null = land;
  while (planet !== null && !planet.name.startsWith("planet:")) planet = planet.parent;
  if (planet === null) return undefined;
  const drawnGates = new Map<number, GatePick>();
  planet.traverse((mark) => {
    const pick = gateOf(mark);
    if (pick !== undefined && isDrawn(mark)) drawnGates.set(pick.gate, pick);
  });
  let best: { pick: GatePick; off: number } | undefined;
  planet.traverse((mark) => {
    if (!mark.name.startsWith("open-work-gate:") || !isDrawn(mark)) return;
    const pick = drawnGates.get(Number(mark.name.slice("open-work-gate:".length)));
    const shape = mark.userData.ring as { centre: { x: number; z: number }; drawn: number; width: number } | undefined;
    const onSurface = mark.parent?.userData.onSurface as ((point: { x: number; z: number }) => Vector3) | undefined;
    if (pick === undefined || shape === undefined || onSurface === undefined) return;
    const { centre, drawn, width } = shape;
    const at = (x: number, z: number) => mark.localToWorld(onSurface({ x: centre.x + x, z: centre.z + z }));
    const middle = at(0, 0), east = at(drawn, 0).sub(middle), south = at(0, drawn).sub(middle);
    const normal = new Vector3().crossVectors(east, south).normalize();
    const along = ray.ray.direction.dot(normal);
    if (Math.abs(along) < 1e-9) return;
    const meets = ray.ray.origin.clone().addScaledVector(ray.ray.direction, middle.clone().sub(ray.ray.origin).dot(normal) / along);
    const off = meets.distanceTo(middle);
    if (off <= east.length() * (1 + width / 2 / drawn) && (best === undefined || off < best.off)) best = { pick, off };
  });
  return best?.pick;
}

/** What stays picked once `selected` is the selection: a gate's ring stays while its own island is selected, as the click on
 * it selects that island (3.88); another selection puts it out. */
export function gateAfterSelection(gate: PickedGate | undefined, selected: string | undefined): PickedGate | undefined {
  return gate?.story === selected ? gate : undefined;
}

/**
 * What a click picks: in Forest, a gate first, which is ringed and selects its island with the pair it joins (3.88);
 * otherwise what `pickGlobe` picks, with no gate, so any other click puts the ring out. A road takes no click, so a click
 * on one picks what lies under it (3.15).
 */
export function pickClick(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }, mode: ForestMode): { gate: PickedGate | undefined; hit: Selection } {
  const gate = mode === "forest" ? pickGate(world, camera, box, cursor) : undefined;
  if (gate === undefined) return { gate: undefined, hit: pickGlobe(world, camera, box, cursor, mode) };
  return { gate, hit: { kind: "story", id: gate.story, gate: gate.pick.between } };
}

/** Project the drawn points; in Forest, solid land before a point occludes it. */
export function pickGlobe(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }, mode: ForestMode): Selection {
  world.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(2 * (cursor.x - box.left) / box.width - 1, 1 - 2 * (cursor.y - box.top) / box.height), camera);
  let landDistance = Infinity;
  if (mode === "forest") {
    for (const hit of ray.intersectObject(world, true)) {
      if (!isDrawn(hit.object)) continue;
      let land = false;
      for (let object: Object3D | null = hit.object; object !== null; object = object.parent) {
        if (object.name.startsWith("planet:")) { land = true; break; }
      }
      if (land) { landDistance = hit.distance; break; }
    }
  }
  const notes: ProjectedNote[] = [];
  world.traverse(object => {
    if (!object.name.startsWith("knowledge-point:") || !isDrawn(object)) return;
    const at = object.getWorldPosition(new Vector3());
    const projected = at.clone().project(camera);
    const inViewport = Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
    notes.push({ id: object.name.slice("knowledge-point:".length),
      x: box.left + (projected.x + 1) * box.width / 2, y: box.top + (1 - projected.y) * box.height / 2,
      z: projected.z, distance: at.sub(ray.ray.origin).dot(ray.ray.direction), visible: inViewport });
  });
  const note = pickProjectedNote(notes, cursor, landDistance);
  if (note !== undefined) return { kind: "note", id: note };
  const land = mode === "forest" ? pickLand(ray, world) : undefined;
  if (land === undefined) return undefined;
  return land.capability === undefined ? { kind: "story", id: land.story } : { kind: "story", id: land.story, capability: land.capability };
}

/** The event the feedback picker dispatches on the canvas to ask what is drawn under the pointer (2.3). A plain string the picker's package pins in its own tests: forest does not depend on it. */
export const FEEDBACK_PICK_EVENT = "storytree:feedback-pick";

/** What the planet view answers a feedback pick with (ADR-1286): the object by its ids, a name, and its box in the window. */
export type FeedbackAnswer = {
  readonly kind: "gate" | "capability" | "island";
  readonly story: string;
  readonly capability?: string;
  readonly between?: [string, string];
  readonly name: string;
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

/**
 * The gate, capability territory or island under `cursor`, for the feedback picker to attach (3.93): a gate first, else a
 * territory, else the island, named as the sheet names them, with the object's bounding box projected to the window. Forest
 * only: Library answers nothing, and neither does a knowledge point or open water.
 */
export function feedbackPick(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }, mode: ForestMode, titles: ReadonlyMap<string, string>): FeedbackAnswer | undefined {
  if (mode !== "forest") return undefined;
  const { gate, hit } = pickClick(world, camera, box, cursor, mode);
  if (hit?.kind !== "story") return undefined;
  const planet = world.getObjectByName(`planet:${hit.id}`) ?? world;
  const capabilityName = (capability: string) => globeName((planet.getObjectByName(`territory:${capability}`)?.userData.title as string | undefined) ?? capability);
  const screenBox = (objects: readonly Object3D[]) => {
    const bounds = new Box3();
    for (const object of objects) bounds.expandByObject(object);
    if (bounds.isEmpty()) return undefined;
    const corners = [bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.y, bounds.max.y].flatMap(y => [bounds.min.z, bounds.max.z].map(z => new Vector3(x, y, z).project(camera))));
    const left = box.left + (Math.min(...corners.map(c => c.x)) + 1) * box.width / 2, right = box.left + (Math.max(...corners.map(c => c.x)) + 1) * box.width / 2;
    const top = box.top + (1 - Math.max(...corners.map(c => c.y))) * box.height / 2, bottom = box.top + (1 - Math.min(...corners.map(c => c.y))) * box.height / 2;
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  world.updateMatrixWorld(true);
  if (gate !== undefined) {
    const marks: Object3D[] = [];
    planet.traverse(object => { if (gateOf(object)?.gate === gate.pick.gate) marks.push(object); });
    const at = screenBox(marks);
    const [a, b] = gate.pick.between;
    return at === undefined ? undefined : { kind: "gate", story: gate.story, between: [a, b], name: `${capabilityName(a)} ↔ ${capabilityName(b)}`, box: at };
  }
  if (hit.capability !== undefined) {
    const at = screenBox([planet.getObjectByName(`territory:${hit.capability}`)].filter((o): o is Object3D => o !== undefined));
    return at === undefined ? undefined : { kind: "capability", story: hit.id, capability: hit.capability, name: capabilityName(hit.capability), box: at };
  }
  const at = screenBox([planet]);
  return at === undefined ? undefined : { kind: "island", story: hit.id, name: titles.get(hit.id) ?? hit.id, box: at };
}

/**
 * Answer the feedback picker's synchronous asks on `target` (3.93): each `FEEDBACK_PICK_EVENT` carries the pointer in its
 * detail, and `answer`'s object for it is written back on the detail. Returns the stop.
 */
export function answerFeedbackPicks(target: EventTarget, answer: (cursor: { x: number; y: number }) => FeedbackAnswer | undefined): () => void {
  const onPick = (event: Event): void => {
    const detail = (event as CustomEvent<{ x: number; y: number; answer?: FeedbackAnswer }>).detail;
    const found = answer({ x: detail.x, y: detail.y });
    if (found !== undefined) detail.answer = found;
  };
  target.addEventListener(FEEDBACK_PICK_EVENT, onPick);
  return () => target.removeEventListener(FEEDBACK_PICK_EVENT, onPick);
}

/** `handle`, run at most once a frame with the latest of the calls made since the last frame. */
export function oncePerFrame<T>(handle: (value: T) => void, schedule: (run: () => void) => unknown = requestAnimationFrame): (value: T) => void {
  let latest: { value: T } | undefined;
  return value => {
    const waiting = latest !== undefined;
    latest = { value };
    if (waiting) return;
    schedule(() => {
      const { value } = latest!;
      latest = undefined;
      handle(value);
    });
  };
}
