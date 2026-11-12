import assert from "node:assert/strict";
import test from "node:test";
import { DoubleSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry } from "three";
import { besidePanel, createGlobeAside, framedOnResize, panelAside } from "./globe-aside.js";
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
  const sheet = { framing: 0.002, sideOffset: 0 };
  assert.deepEqual(besidePanel(narrow, panel, sheet, false), { framing: 0.002, sideOffset: -246 }, "the glass sheet only slides: it runs on past the free width, to pan to");
  assert.deepEqual(createGlobeAside(() => sheet, { fit: false }).place(narrow, panel, sheet)?.to, { framing: 0.002, sideOffset: -246 });
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
  // 900 px of short side over the 1084 px left once the panel and a 12 px margin each side are taken.
  assert.ok(Math.abs(open!.to.framing - 0.8303) < 1e-4, `zoomed out only to the fit (${open?.to.framing})`);
  const wheeledAgain = { framing: 3, sideOffset: open!.to.sideOffset };
  assert.deepEqual(aside.place(wide, 0, wheeledAgain)?.to, { framing: 3, sideOffset: 0 }, "the wheel moved it since: its zoom stays");
});

test("3.40 a resize keeps the globe centred in the free space, at once; Home returns to the shifted place while the panel is open", () => {
  const aside = createGlobeAside(() => opening);
  const open = aside.place(wide, panel, opening)!;
  const resized = aside.place({ width: 1200, height: 900 }, panel, open.to);
  assert.ok(resized !== undefined && !resized.glide && resized.to.sideOffset === -246);
  assert.ok(Math.abs(resized.to.framing - 1.3158) < 1e-4, `the narrower window's 684 px free width fits the globe (${resized.to.framing})`);
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

test("3.40 the sheet slides the picked island to the middle of the free width, whole, and closing slides back by as much", () => {
  // The desktop's map at 1440x960 with the rail open: 1008 px of canvas, the panel covering its right 492.
  const canvas = { width: 1008, height: 912 }, rest = { framing: 0.4, sideOffset: 0 }, aside = createGlobeAside(() => rest, { fit: false });
  // An island at canvas x 272 is already in the free width: half the panel's slide would put it at 26, cut by the edge.
  const open = aside.place(canvas, panel, rest, 272);
  assert.deepEqual(open, { to: { framing: 0.4, sideOffset: -14 }, glide: true }, "to x 258, the middle of the 516 px left free");
  assert.deepEqual(aside.place(canvas, 0, open!.to)?.to, rest, "closing slides back by exactly that");
  assert.deepEqual(aside.place(canvas, panel, rest)?.to, { framing: 0.4, sideOffset: -246 }, "no picked island (the Library's note card): half the panel");
});

test("3.85 the map's frame changing size keeps the zoom on screen and the place under its unchanged edge where it was", () => {
  const before = { width: 1000, height: 600, left: 280 }, pose = { framing: 0.4, sideOffset: -120 };
  // The left rail hides: the frame's left edge moves out to the window's, its right edge stays.
  const hidden = framedOnResize(pose, before, { width: 1280, height: 600, left: 0 });
  assert.deepEqual(hidden, { framing: 0.4, sideOffset: 20 }, "no rescale; the middle of the view keeps its distance from the right edge");
  assert.deepEqual(framedOnResize(hidden, { width: 1280, height: 600, left: 0 }, before), pose, "showing it again covers that map and gives back the view");
  // The window narrows from its right: the left edge stays, and so does what is drawn against it.
  assert.deepEqual(framedOnResize(pose, before, { width: 800, height: 600, left: 280 }), { framing: 0.4, sideOffset: -20 });
  // The window shortens: the short side drawn the same number of pixels per unit is fewer radii of the map.
  assert.deepEqual(framedOnResize(pose, before, { width: 1000, height: 300, left: 280 }), { framing: 0.2, sideOffset: -120 });
  assert.equal(framedOnResize(pose, before, { ...before }), undefined, "the same frame: nothing to post");
});

test("3.85 with the sheet beside the panel a resize leaves it where the frame's change put it, and closing slides back by the panel alone", () => {
  const rest = { framing: 0.4, sideOffset: 0 }, aside = createGlobeAside(() => rest, { fit: false });
  const open = aside.place(wide, panel, rest)!.to;
  assert.equal(aside.place({ width: 1880, height: 900 }, panel, { framing: 0.4, sideOffset: open.sideOffset + 140 }), undefined, "the resize's own place stands");
  assert.deepEqual(aside.place({ width: 1880, height: 900 }, 0, { framing: 0.4, sideOffset: open.sideOffset + 140 })?.to, { framing: 0.4, sideOffset: 140 });
  // Opened on a window too narrow to slide into, then widened: Home places it beside the panel, and closing undoes that.
  assert.equal(aside.place({ width: 600, height: 900 }, panel, rest), undefined, "no useful free width: no slide");
  const home = aside.home(wide);
  assert.deepEqual(home, { framing: 0.4, sideOffset: -246 }, "Home beside the panel");
  assert.deepEqual(aside.place(wide, 0, home)?.to, rest, "closing after Home slides back to the opening");
});
