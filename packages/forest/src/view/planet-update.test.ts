import assert from "node:assert/strict";
import { test } from "node:test";
import { workStates } from "@storytree/arc-surface";
import { forestScene, type ForestScene, type Island, type SessionWisp } from "@storytree/forest";
import type { AnnotatedTree } from "@storytree/library";
import type { PinReading } from "@storytree/map/pins";
import { fc, propertyCheck } from "@storytree/property-checks";
import { claimsInside, claimsOn, gatePosts, nextScene, pointersOn, sameWisps } from "./planet-update.js";
import { oncePerFrame } from "./planet-navigation.js";

const health = { reported: { state: "not-checked" as const }, verified: { state: "not-checked" as const } };
const tree = (title: string): AnnotatedTree => ({ arcs: [], stories: [
  { id: "a", title, health, capabilities: [] },
  { id: "b", title: "B", health, capabilities: [] },
] });
const places = () => new Map([["a", 1], ["b", 2]]);

test("3.2 a live update whose scene and places draw the same as those on show is not drawn again", () => {
  const shown = forestScene(tree("A"), [], workStates([]));
  assert.equal(nextScene({ scene: shown, places: places() }, forestScene(tree("A"), [], workStates([])), places()), undefined);
  assert.notEqual(nextScene({ scene: shown, places: places() }, forestScene(tree("A"), [], workStates([])), new Map([["a", 1], ["b", 3]])), undefined,
    "a moved place is drawn");
});

test("3.2 a live update that changed one island keeps the other island's objects, so only the changed plate re-derives", () => {
  const shown = forestScene(tree("A"), [], workStates([]));
  const next = nextScene({ scene: shown, places: places() }, forestScene(tree("A renamed"), [], workStates([])), places());
  assert.ok(next !== undefined);
  assert.notEqual(next.islands[0], shown.islands[0]);
  assert.equal(next.islands[1], shown.islands[1]);
});

test("wisps that draw the same as those on show are not drawn again", () => {
  const wisp = (capabilities: string[]): SessionWisp => ({ session: "s", story: "a", colour: "hsl(1, 80%, 68%)", faded: false, capabilities });
  assert.ok(sameWisps([wisp(["c"])], [wisp(["c"])]));
  assert.ok(!sameWisps([wisp(["c"])], [wisp(["c", "d"])]));
  assert.ok(!sameWisps([wisp(["c"])], [{ ...wisp(["c"]), faded: true }]));
  assert.ok(!sameWisps([wisp(["c"])], [{ ...wisp(["c"]), pointer: { capability: "c" } }]), "a pointer that came or went is drawn");
});

test("a claim on another island leaves this island's tints as they were, so its territories are not cut again", () => {
  const land = { territories: [{ capability: "mine", lines: 10 }, { lines: 3 }], files: [] };
  const tint = { colour: "hsl(1, 80%, 68%)", faded: false };
  const before = claimsOn(new Map([["mine", tint]]), land);
  assert.equal(claimsOn(new Map([["mine", tint], ["elsewhere", tint]]), land), before);
  assert.notEqual(claimsOn(new Map([["mine", { ...tint, faded: true }]]), land), before);
});

test("5.8 · an island pulses only the pointers on its own territories, and one on another island leaves its pointers as they were", () => {
  const land = { territories: [{ capability: "mine", lines: 10 }, { lines: 3 }, { capability: "also", lines: 4 }], files: [] };
  const pointer = (colour: string) => ({ colour });
  const here = pointersOn(new Map([["elsewhere", pointer("#111")], ["also", pointer("#222")], ["mine", pointer("#333")]]), land);
  assert.deepEqual([...here], [["mine", pointer("#333")], ["also", pointer("#222")]], "its own, in its territories' order; none from another island");
  assert.deepEqual([...pointersOn(new Map([["elsewhere", pointer("#111")]]), land)], [], "a pointer elsewhere pulses nothing here");
});

test("the pointer is picked at most once a frame, at its latest place", () => {
  const frames: (() => void)[] = [];
  const picked: number[] = [];
  const move = oncePerFrame((x: number) => picked.push(x), run => frames.push(run));
  move(1); move(2); move(3);
  assert.deepEqual(picked, []);
  frames.splice(0).forEach(run => run());
  assert.deepEqual(picked, [3]);
  move(4);
  frames.splice(0).forEach(run => run());
  assert.deepEqual(picked, [3, 4]);
});

test("3.68 a live update that changes only a plumbing call is drawn, and one that changes nothing on show is not", () => {
  const call = { from: "a", to: "b", kind: "build step" as const, files: ["bins/build.ts"] };
  const shown = forestScene(tree("A"), [], workStates([]));
  const onShow = { scene: { ...shown, plumbing: [call] }, places: places() };
  assert.equal(nextScene(onShow, { ...shown, plumbing: [{ ...call }] }, places()), undefined, "the same call is not drawn again");
  assert.notEqual(nextScene(onShow, { ...shown, plumbing: [] }, places()), undefined, "a call that went is drawn");
  assert.notEqual(nextScene(onShow, { ...shown, plumbing: [call, { ...call, kind: "cleanup" as const }] }, places()), undefined, "a call that came is drawn");
  assert.notEqual(nextScene(onShow, { ...shown, plumbing: [{ ...call, files: ["bins/other.ts"] }] }, places()), undefined, "a call from other files is drawn");
});

test("5.9 · an island pulses a gate pointer only when both its capabilities are its territories", () => {
  const land = { territories: [{ capability: "mine", lines: 10 }, { capability: "also", lines: 4 }], files: [] };
  const gate = (pair: [string, string]) => ({ colour: "#444", gate: pair });
  const here = pointersOn(new Map([["also|mine", gate(["also", "mine"])], ["elsewhere|mine", gate(["elsewhere", "mine"])]]), land);
  assert.deepEqual([...here], [["also|mine", gate(["also", "mine"])]], "its own gate; none to another island's capability");
  const posts = gatePosts([{ at: { x: 1, z: 2 }, between: ["also", "mine"] }, { at: { x: 5, z: 5 }, between: ["also", "mine"] }]);
  assert.deepEqual([...posts], [["also|mine", { x: 1, z: 2 }]], "it pulses at the first gate a road makes between the pair");
});

test("3.92 a live update that only puts a contract on an edge or a capability is drawn, so the selected arc's open work rings its gate before any claim", () => {
  const shown = forestScene(tree("A"), [], workStates([]));
  const edge = { from: "cap_x", to: "cap_y", contracts: ["contract_1"] };
  const onShow = { scene: { ...shown, edges: [edge], contracts: [{ capability: "cap_x", contracts: ["contract_2"] }] }, places: places() };
  assert.equal(nextScene(onShow, { ...onShow.scene, edges: [{ ...edge }], contracts: [{ capability: "cap_x", contracts: ["contract_2"] }] }, places()), undefined, "the same edges and contracts are not drawn again");
  assert.notEqual(nextScene(onShow, { ...onShow.scene, edges: [{ ...edge, contracts: ["contract_1", "contract_3"] }] }, places()), undefined, "a contract planned on an edge is drawn");
  assert.notEqual(nextScene(onShow, { ...onShow.scene, contracts: [{ capability: "cap_x", contracts: ["contract_2", "contract_4"] }] }, places()), undefined, "a contract planned on a capability is drawn");
});

test("3.119 · a live update whose only change is a pin written, or one gone stale, is drawn", () => {
  const pin = { pin: { id: "pin_1", type: "pin", fields: { anchor: { capability: "cap" }, icon: "cache", label: "A cache", evidence: "seen", commit: "abc", at: "2026-11-16T00:00:00.000Z" } } } as never as import("@storytree/map/pins").PinReading;
  const shown = forestScene(tree("A"), [], workStates([]));
  const pinned = forestScene(tree("A"), [], workStates([]), {}, [pin]);
  assert.notEqual(nextScene({ scene: shown, places: places() }, pinned, places()), undefined, "a pin written");
  assert.notEqual(nextScene({ scene: pinned, places: places() }, forestScene(tree("A"), [], workStates([]), {}, [{ ...pin, stale: "gone" }]), places()), undefined, "a pin gone stale");
  assert.equal(nextScene({ scene: pinned, places: places() }, forestScene(tree("A"), [], workStates([]), {}, [pin]), places()), undefined, "the same pin is not drawn again");
});

test("3.122 · a claim moving between the capabilities inside a top part redraws the part's opened land, and one elsewhere leaves it as it was", () => {
  const parts = [{ shares: [{ capability: "button" }, { capability: "form" }, {}] }];
  const tint = { colour: "hsl(1, 80%, 68%)", faded: false };
  const before = claimsInside(new Map([["form", tint]]), parts);
  assert.notEqual(claimsInside(new Map([["button", tint]]), parts), before, "the flag moves from form to button");
  assert.equal(claimsInside(new Map([["form", tint], ["elsewhere", tint]]), parts), before);
});

const stories = ["story_a", "story_b", "story_c", "story_d"] as const;
const capabilities = ["cap_x", "cap_y", "cap_z", "cap_w"] as const;
const story = fc.constantFrom(...stories);
const capability = fc.constantFrom(...capabilities);
const word = fc.constantFrom("proposed" as const, "healthy" as const, "unhealthy" as const, "untested" as const);
const name = fc.constantFrom("Map view", "Story node render", "Library", "Gate", "Lanes");
const few = <T>(item: fc.Arbitrary<T>) => fc.array(item, { maxLength: 3 });
const island: fc.Arbitrary<Island> = fc.record({
  story,
  title: name,
  x: fc.double({ min: -500, max: 500, noNaN: true }),
  z: fc.double({ min: -500, max: 500, noNaN: true }),
  trees: few(fc.record({ capability: fc.option(capability, { nil: undefined }), form: fc.constantFrom("seedling" as const, "pale" as const, "green" as const, "dead" as const), status: word, contracts: fc.nat(12) })),
  land: fc.record({ territories: few(fc.record({ capability, status: word, lines: fc.integer({ min: 1, max: 4000 }) })), files: few(fc.record({ path: fc.constantFrom("src/a.ts", "src/b.ts", "src/c.ts"), lines: fc.integer({ min: 1, max: 900 }), capability })) }),
  area: fc.integer({ min: 100, max: 90000 }),
}, { requiredKeys: ["story", "title", "x", "z", "trees"] }).map(({ story, ...drawn }) => ({ story, ...drawn, key: JSON.stringify(drawn) }));
const link = fc.record({ from: capability, to: capability });
const fields: { readonly [K in keyof Required<ForestScene>]-?: fc.Arbitrary<NonNullable<ForestScene[K]>> } = {
  islands: fc.uniqueArray(island, { selector: ({ story }) => story, minLength: 1, maxLength: 4 }),
  links: few(fc.record({ from: capability, to: capability, typeOnly: fc.constant(true as const) }, { requiredKeys: ["from", "to"] })),
  plumbing: few(fc.record({ from: story, to: story, kind: fc.constantFrom("build step" as const, "cleanup" as const, "forwarder" as const), files: few(fc.constantFrom("bins/build.ts", "bins/clean.ts")) })),
  stores: few(fc.record({ address: fc.constantFrom("postgres://local/storytree", "postgres://mint/library"), medium: fc.constantFrom("postgres", "sqlite"), tables: few(fc.constantFrom("record", "change", "claim")) })),
  edges: few(fc.record({ from: capability, to: capability, contracts: few(fc.constantFrom("contract_1", "contract_2", "contract_3")) })),
  contracts: few(fc.record({ capability, contracts: few(fc.constantFrom("contract_1", "contract_2", "contract_3")) })),
  parts: few(fc.record({
    story,
    capability,
    shares: few(fc.record({ capability, title: name, lines: fc.integer({ min: 1, max: 4000 }), status: word, parked: fc.constant(true as const), description: name }, { requiredKeys: ["capability", "title", "lines"] })),
    links: few(link),
    lanes: fc.dictionary(fc.constantFrom("cap_x->cap_y", "cap_y->cap_z"), few(capability), { maxKeys: 2 }),
    clashes: fc.dictionary(fc.constantFrom("src/a.ts", "src/b.ts"), few(capability), { maxKeys: 2 }),
  }, { requiredKeys: ["story", "capability", "shares", "links", "lanes"] })),
  pins: few(fc.record({
    pin: fc.record({ id: fc.constantFrom("pin_1", "pin_2"), type: fc.constant("pin"), fields: fc.record({ anchor: fc.record({ capability }), icon: fc.constantFrom("cache", "queue", "api"), label: name, evidence: name, commit: fc.constantFrom("abc123", "def456"), at: fc.constant("2026-11-16T00:00:00.000Z") }) }),
    stale: fc.constant("gone"),
  }, { requiredKeys: ["pin"] }).map((reading) => reading as never as PinReading)),
};
const keys = Object.keys(fields) as (keyof ForestScene)[];
const shownScene: fc.Arbitrary<ForestScene> = fc.record(fields, { requiredKeys: ["islands"] });
const oneField = fc.constantFrom(...keys).chain((key) => (fields[key] as fc.Arbitrary<unknown>).map((value) => ({ key, value })));
const placesOf = (scene: ForestScene) => new Map(scene.islands.map(({ story }, index) => [story, index]));

test("3.2 · a live update whose only change is in any one field of the scene is drawn, never dropped, and the same scene is not drawn again (escape_1fee55c9d4ab)", async (t) => {
  await propertyCheck(t, { why: { pattern: "escape_1fee55c9d4ab" } }, fc.property(shownScene, oneField, (shown, { key, value }) => {
    fc.pre(JSON.stringify(shown[key] ?? []) !== JSON.stringify(value));
    const onShow = { scene: shown, places: placesOf(shown) };
    assert.equal(nextScene(onShow, structuredClone(shown), placesOf(shown)), undefined, "the same scene is not drawn again");
    assert.notEqual(nextScene(onShow, { ...structuredClone(shown), [key]: value }, placesOf(shown)), undefined, `a change in ${key} alone is drawn`);
  }));
});
