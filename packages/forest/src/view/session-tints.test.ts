/**
 * Capability 5 · Agent capability claims (the forest story): a running session plants a flag in its colour on each
 * territory it claimed; the flag is the only claim mark (ADR-0968, ADR-0923).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, Group, Mesh, Quaternion, Vector3, type LineSegments, type MeshBasicMaterial } from "three";

import { claimTints, type SessionWisp } from "@storytree/forest";
import { territories } from "../territories/territories.js";
import { ClaimMarks, claimMoment, flagScale } from "./claim-flag.js";
import { territoryLand } from "./territory-land.js";

const wisp = (session: string, story: string, colour: string, capabilities: string[] = []): SessionWisp => ({ session, story, colour, faded: false, capabilities });
const flat = (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z);
const up = () => new Vector3(0, 1, 0);
const eye = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const share = (capability: string, lines = 1) => ({ capability, lines });
const meshes = (root: Group) => { const found: Mesh[] = []; root.traverse(o => { if (o instanceof Mesh) found.push(o); }); return found; };

/** Marks for `land` with `tints`, drawn once at a resting zoom (an island about 90 px wide). */
const marked = (map: ReturnType<typeof territories>, tints: ReturnType<typeof claimTints>, unsurveyed = false, reduced = false) => {
  const marks = new ClaimMarks();
  marks.setLand(map, flat, up, unsurveyed);
  marks.claims(tints, 0, { standing: true, reduced });
  marks.frame(0, { zoom: 2, eye, reduced });
  return marks;
};

test("5.6 a capability a session has claimed carries one flag in that session's colour, furled and greyed once it is quiet; no band or fill is drawn for a claim", () => {
  const tints = claimTints([wisp("A", "shop", "hsl(200, 80%, 68%)", ["cap-a"]), { ...wisp("C", "shop", "hsl(300, 80%, 68%)", ["cap-c"]), faded: true }]);
  assert.deepEqual([...tints], [["cap-a", { colour: "hsl(200, 80%, 68%)", faded: false }], ["cap-c", { colour: "hsl(300, 80%, 68%)", faded: true }]]);
  const map = territories([share("cap-a", 40), share("cap-b", 30), share("cap-c", 30)], 20);
  const marks = marked(map, tints);
  const flag = marks.root.getObjectByName("territory-claim:cap-a")!;
  assert.ok(flag !== undefined, "the claimed territory has a flag");
  assert.equal(marks.root.getObjectByName("territory-claim:cap-b"), undefined, "an unclaimed territory has none");
  assert.deepEqual(flag.userData, { claim: true, capability: "cap-a", colour: "hsl(200, 80%, 68%)", faded: false });
  const pennant = flag.getObjectByName("flag-pennant") as Mesh;
  assert.ok((pennant.material as MeshBasicMaterial).color.equals(new Color("hsl(200, 80%, 68%)")), "the pennant wears the session's colour");
  assert.ok(((flag.getObjectByName("flag-pole") as Mesh).material as MeshBasicMaterial).color.equals(new Color("#0d1114")), "on a dark pole");
  // The foot stands inside its own territory, at the cell the capability's nameplate uses.
  const foot = flag.getObjectByName("claim-flag")!.position;
  const at = map.cells.find(cell => Math.hypot(cell.site.x - foot.x, cell.site.z - foot.z) < 1e-9);
  assert.equal(at?.territory, 0, "the flag stands on its own territory");
  // Quiet is a change of shape: the pennant is shorter and droops, and its colour greys.
  const quiet = marks.root.getObjectByName("territory-claim:cap-c")!;
  const reach = (o: Mesh) => { o.geometry.computeBoundingBox(); return o.geometry.boundingBox!; };
  const [held, furled] = [pennant, quiet.getObjectByName("flag-pennant") as Mesh].map(reach);
  assert.ok(furled!.max.x - furled!.min.x < 0.5 * (held!.max.x - held!.min.x), "a quiet pennant hangs furled");
  assert.ok(furled!.min.y < held!.min.y, "its tip droops");
  const grey = (quiet.getObjectByName("flag-pennant") as Mesh).material as MeshBasicMaterial;
  assert.ok(grey.color.getHSL({ h: 0, s: 0, l: 0 }).s < new Color("hsl(300, 80%, 68%)").getHSL({ h: 0, s: 0, l: 0 }).s, "and greys");
  assert.equal(quiet.userData.faded, true);
  // No band: the territories' land carries no claim mark at all, and its fill is a plain territory's.
  const land = territoryLand(map, flat, undefined, tints);
  land.traverse(o => assert.ok(!o.name.startsWith("territory-claim") && !o.userData.claim, `${o.name} is not a claim mark`));
  assert.ok(((land.getObjectByName("territory:cap-a") as Mesh).material as MeshBasicMaterial).color.equals(new Color("#F2D16B")), "the fill still says its word");
});

test("5.6 a flag keeps its size on screen and stands upright, and on a small island is a dot", () => {
  assert.deepEqual([90, 200, 480].map(px => Math.round(flagScale(px).k * 100) / 100), [0.6, 0.9, 1.3], "the three drawn sizes");
  assert.ok(flagScale(40).dot && !flagScale(90).dot, "a dot where an island is about 45 px wide or less");
  const map = territories([share("cap-a")], 20);
  const marks = marked(map, new Map([["cap-a", { colour: "#56b4e9", faded: false }]]));
  const flag = marks.root.getObjectByName("claim-flag")!;
  const tall = (zoom: number) => {
    marks.frame(0, { zoom, eye, reduced: false });
    flag.updateWorldMatrix(true, true);
    const pole = flag.getObjectByName("flag-pole") as Mesh;
    pole.geometry.computeBoundingBox();
    const box = pole.geometry.boundingBox!.clone().applyMatrix4(pole.matrixWorld);
    return { px: (box.max.z - box.min.z) * zoom, upright: box.max.x - box.min.x < box.max.z - box.min.z };
  };
  // At the resting globe's zoom the pole is about 16 px, its round caps aside; zoomed in it grows only as the drawn sizes say, never with the ground.
  const rest = tall(90 / 44), close = tall(480 / 44);
  assert.ok(Math.abs(rest.px - (0.6 * 26 + 1.5)) < 0.5 && Math.abs(close.px - (1.3 * 26 + 1.3 * 2.2)) < 0.5, `${rest.px} and ${close.px} px`);
  assert.ok(rest.upright && close.upright, "the pole is vertical on screen");
  marks.frame(0, { zoom: 30 / 44, eye, reduced: false });
  assert.ok(marks.root.getObjectByName("flag-dot")!.visible && !marks.root.getObjectByName("flag-pole")!.visible, "the far-out flag is a dot");
});

test("5.6 a claim on an island with no code stands in its share, marked as a lot; with code there is no lot, and a capability with no lines draws nothing", () => {
  const tints = new Map([["cap-a", { colour: "#56b4e9", faded: false }], ["cap-b", { colour: "#cc79a7", faded: false }]]);
  const bare = territories([share("cap-a"), share("cap-b"), share("cap-c")], 20);
  const lots = marked(bare, tints, true);
  for (const capability of ["cap-a", "cap-b"]) {
    assert.ok(lots.root.getObjectByName(`territory-claim:${capability}`), `${capability} has its flag`);
    const lot = lots.root.getObjectByName(`claim-lot:${capability}`) as LineSegments;
    assert.ok(lot.geometry.getAttribute("position").count >= 8, `${capability}'s share is marked as a lot`);
    assert.ok(new Color("#f4f7f8").equals((lot.material as MeshBasicMaterial).color));
  }
  assert.equal(lots.root.getObjectByName("claim-lot:cap-c"), undefined, "an unclaimed share is no lot");
  // Every dash lies inside its own share.
  const lot = lots.root.getObjectByName("claim-lot:cap-a") as LineSegments, position = lot.geometry.getAttribute("position");
  const nearest = (x: number, z: number) => bare.cells.reduce((best, cell) => Math.hypot(cell.site.x - x, cell.site.z - z) < Math.hypot(best.site.x - x, best.site.z - z) ? cell : best);
  assert.ok(Array.from({ length: position.count }, (_, i) => nearest(position.getX(i), position.getZ(i)).territory).every(t => t === 0), "the lot stays in its share");
  const built = marked(territories([share("cap-a", 30), share("cap-b", 20)], 20), tints);
  assert.ok(built.root.getObjectByName("territory-claim:cap-a") && built.root.getObjectByName("claim-lot:cap-a") === undefined, "an island with code has flags and no lots");
  const zero = marked(territories([share("cap-a", 30), share("cap-b", 0)], 20), tints);
  assert.equal(zero.root.getObjectByName("territory-claim:cap-b"), undefined, "a capability with no ground on a built island draws nothing");
});

test("5.6 a claim drops in with one ring at its foot, stands still while held, furls when quiet, and lifts away when it goes; with reduced motion each jumps to its end", () => {
  // The arrival: fades in by 0.24 s, settles by 0.66 s, its ring opens from 0.48 s and is gone by 1.2 s.
  const at = (s: number) => claimMoment({ arrived: 0, quiet: { from: 0, to: 0, at: 0 }, now: s, reduced: false });
  assert.ok(at(0).lift > 0 && at(0).opacity === 0);
  assert.equal(at(0.24).opacity, 1);
  assert.ok(at(0.4).lift < 0, "it overshoots its place");
  assert.equal(at(0.66).lift, 0);
  assert.equal(at(0.47).ring, undefined); assert.ok(at(0.6).ring! > 0 && at(0.6).ring! < 1);
  assert.equal(at(1.2).ring, undefined);
  assert.equal(at(0.3).lot < 1 && at(0.6).lot === 1, true, "the lot fades in over the first 0.6 s");
  assert.deepEqual([at(1.2).live, at(5).live], [false, false], "a held flag asks for no frames");
  // Quiet over 0.8 s, and back.
  const quiet = (s: number, reduced = false) => claimMoment({ quiet: { from: 0, to: 1, at: 10 }, now: 10 + s, reduced }).quiet;
  assert.ok(quiet(0.4) > 0 && quiet(0.4) < 1); assert.equal(quiet(0.8), 1); assert.equal(quiet(0, true), 1);
  // Leaving: rises while fading over 0.8 s.
  const going = (s: number) => claimMoment({ quiet: { from: 0, to: 0, at: 0 }, left: 20, now: 20 + s, reduced: false });
  assert.ok(going(0.4).lift > 0 && going(0.4).opacity < 1 && going(0.4).opacity > 0);
  assert.equal(going(0.8).opacity, 0);
  // Reduced motion: no drop, no ring, no fade.
  const still = claimMoment({ arrived: 0, quiet: { from: 0, to: 0, at: 0 }, now: 0, reduced: true });
  assert.deepEqual([still.lift, still.opacity, still.ring, still.lot, still.live], [0, 1, undefined, 1, false]);
  assert.equal(claimMoment({ quiet: { from: 0, to: 0, at: 0 }, left: 0, now: 0, reduced: true }).opacity, 0);

  // Driven: a claim that arrives later plays its arrival; a released one stays until it has lifted away.
  const marks = new ClaimMarks();
  marks.setLand(territories([share("cap-a"), share("cap-b")], 20), flat, up, false);
  marks.claims(new Map(), 0, { standing: true, reduced: false });
  marks.claims(new Map([["cap-a", { colour: "#56b4e9", faded: false }]]), 1, { standing: false, reduced: false });
  assert.equal(marks.frame(1.1, { zoom: 2, eye, reduced: false }), true, "an arriving flag asks for frames");
  assert.ok(marks.root.getObjectByName("claim-ring")!.visible === false);
  marks.frame(1.7, { zoom: 2, eye, reduced: false });
  assert.ok(marks.root.getObjectByName("claim-ring")!.visible, "the ring opens at its foot");
  assert.equal(marks.frame(3, { zoom: 2, eye, reduced: false }), false, "then it stands still");
  marks.claims(new Map(), 4, { standing: false, reduced: false });
  assert.equal(marks.frame(4.4, { zoom: 2, eye, reduced: false }), true);
  assert.ok(marks.root.getObjectByName("territory-claim:cap-a"), "a released flag lifts away before it goes");
  marks.frame(4.9, { zoom: 2, eye, reduced: false });
  assert.equal(marks.root.getObjectByName("territory-claim:cap-a"), undefined, "and then it is gone");
  marks.dispose();
});
