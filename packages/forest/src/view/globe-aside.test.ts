import assert from "node:assert/strict";
import test from "node:test";
import { DoubleSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry } from "three";
import { besidePanel, createGlobeAside, panelAside } from "./globe-aside.js";
import { pickGlobe } from "./planet-navigation.js";

const wide = { width: 1600, height: 900 }, narrow = { width: 1000, height: 900 };
const opening = { framing: 1.18, sideOffset: 0 };
// The story panel's 30rem plus its 0.75rem gutter, as the page measures it.
const panel = 492;

test("3.40 with the panel open the globe's centre sits mid-way across the free width; on a wide window it neither zooms nor turns", () => {
  const beside = besidePanel(wide, panel, opening);
  assert.equal(beside.sideOffset, -246, "minus half of the panel and its gutter");
  assert.equal(beside.framing, 1.18, "the globe already fits the free width");
  assert.deepEqual(besidePanel(wide, 0, opening), opening, "no panel: the opening place");
  assert.deepEqual(besidePanel(narrow, narrow.width - 12, opening), opening, "a panel covering nearly the whole window moves nothing");
});

test("3.40 when the free width is narrower than the globe, it zooms out just enough to fit, and no further", () => {
  const beside = besidePanel(narrow, panel, opening);
  const diameter = Math.min(narrow.width, narrow.height) / beside.framing;
  assert.ok(beside.framing > 1.18, "zoomed out");
  assert.ok(diameter <= narrow.width - panel && diameter > narrow.width - panel - 30, `fits the free width snugly (${diameter.toFixed(0)}px)`);
  assert.equal(besidePanel(narrow, panel, { framing: 4, sideOffset: 0 }).framing, 4, "already further out than the fit: left alone");
});

test("3.40 opening glides aside; another island picked with the panel open moves nothing; closing glides back to the zoom it had", () => {
  const aside = createGlobeAside(() => opening);
  assert.equal(aside.place(narrow, 0, opening), undefined, "nothing open: nothing to do");
  assert.equal(aside.place(wide, 0, { framing: 2, sideOffset: 90 }), undefined, "no panel: a resize leaves the host's own offset alone");
  const open = aside.place(narrow, panel, opening);
  assert.ok(open !== undefined && open.glide);
  assert.equal(open.to.sideOffset, -246); assert.ok(open.to.framing > 1.18);
  assert.equal(aside.place(narrow, panel, open.to), undefined, "picking another island keeps the panel's width: no move");
  const closed = aside.place(narrow, 0, open.to);
  assert.deepEqual(closed, { to: opening, glide: true }, "back to the opening place and its earlier zoom");
});

test("3.40 the user's own wheel zoom is never fought: only the fit is applied, and closing keeps a zoom the wheel chose", () => {
  const aside = createGlobeAside(() => opening);
  const wheeledIn = { framing: 0.6, sideOffset: 0 };
  const open = aside.place(wide, panel, wheeledIn);
  assert.equal(open?.to.framing, Math.min(wide.width, wide.height) / (wide.width - panel - 24), "zoomed out only to the fit");
  const wheeledAgain = { framing: 3, sideOffset: open!.to.sideOffset };
  assert.deepEqual(aside.place(wide, 0, wheeledAgain)?.to, { framing: 3, sideOffset: 0 }, "the wheel moved it since: its zoom stays");
});

test("3.40 a resize keeps the globe centred in the free space, at once; Home returns to the shifted place while the panel is open", () => {
  const aside = createGlobeAside(() => opening);
  const open = aside.place(wide, panel, opening)!;
  const resized = aside.place({ width: 1200, height: 900 }, panel, open.to);
  assert.deepEqual(resized, { to: { framing: 900 / (1200 - panel - 24), sideOffset: -246 }, glide: false });
  assert.deepEqual(aside.home({ width: 1200, height: 900 }), resized!.to, "Home: the opening view, beside the panel");
  aside.place({ width: 1200, height: 900 }, 0, resized!.to);
  assert.deepEqual(aside.home({ width: 1200, height: 900 }), opening, "Home with the panel closed: the opening view");
});

test("3.40 the page measures the panel's width plus its gutter from the window's right edge; a hidden panel covers nothing", () => {
  const box = (left: number, right: number) => ({ left, right });
  assert.equal(panelAside(box(0, 1600), [box(1096, 1588)]), 504);
  assert.equal(panelAside(box(0, 1600), []), 0, "hidden: no box drawn");
  assert.equal(panelAside(box(0, 1600), [box(1700, 1800)]), 0, "off the window: nothing covered");
});

test("3.40 under a side offset a click picks the island drawn where it was clicked", () => {
  const world = new Group(), plate = new Group();
  plate.name = "planet:story";
  plate.add(new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ side: DoubleSide })));
  world.add(plate);
  const camera = new OrthographicCamera(-400, 400, 300, -300, 0.1, 100);
  camera.position.z = 40; camera.zoom = 10;
  // The globe moved 246 px left: the island at the origin is drawn at x = 400 - 246.
  camera.setViewOffset(800, 600, 246, 0, 800, 600);
  const box = { left: 0, top: 0, width: 800, height: 600 };
  assert.equal(pickGlobe(world, camera, box, { x: 154, y: 300 }, "forest")?.id, "story", "picked where it is drawn");
  assert.equal(pickGlobe(world, camera, box, { x: 400, y: 300 }, "forest"), undefined, "the window's centre is now empty sea");
});
