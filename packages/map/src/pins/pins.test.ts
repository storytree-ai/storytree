import assert from "node:assert/strict";
import { test } from "node:test";

import type { SharedStore, SurveyedPart } from "@storytree/library";

import { parseAnchor, pinWorldOf, placePins, readPins, retirePin, writePin, type Pin, type PinInput, type PinShelf, type PinWorld } from "./pins.js";

const CACHE = "capability_00000000000a";
const WEB = "capability_00000000000b";

/** A pin shelf kept in memory, as the library keeps pin records, with what was retired and why. */
function shelf(): PinShelf & { retired: Map<string, string> } {
  const pins = new Map<string, Pin>();
  const retired = new Map<string, string>();
  let next = 0;
  return {
    retired,
    list: async () => [...pins.values()],
    async record(fields) {
      const pin = { id: `pin_${String(++next).padStart(12, "0")}`, type: "pin", fields: { ...fields, at: "2026-11-15T09:00:00.000Z" } } as unknown as Pin;
      pins.set(pin.id, pin);
      return pin;
    },
    get: async (id) => pins.get(id) ?? null,
    async retire(id, reason) {
      pins.delete(id);
      retired.set(id, reason);
    },
  };
}

const part = (folder: string, files: string[], parts: SurveyedPart[] = []): SurveyedPart => ({ folder, entry: `${folder}/index.ts`, files, parts });
const store = (address: string, tables: string[] = []): SharedStore => ({ address, medium: "postgres", evidence: [{ file: "compose.yaml", says: "postgres" }], tables: tables.map((name) => ({ name, columns: [], foreignKeys: [], from: [] })) });

/** A checkout: the cache capability's files, one part nested inside another, the text of each file, and the shared stores. */
function world(texts: Record<string, string>, stores: SharedStore[] = [store("postgres://db/app", ["users"])]): PinWorld {
  const nested = part("pkg/src/infra/cache", ["pkg/src/infra/cache/index.ts", "pkg/src/infra/cache/lru.ts"]);
  const infra = part("pkg/src/infra", ["pkg/src/infra/index.ts"], [nested]);
  const files = Object.keys(texts).filter((file) => file.startsWith("pkg/"));
  return {
    capability: (id) => (id === CACHE ? { files, parts: files.includes("pkg/src/infra/index.ts") ? [infra] : [], root: "/checkout" } : id === WEB ? { files: [], parts: [], root: "/checkout" } : undefined),
    stores,
    readText: async (file) => texts[file.replace(/^\/checkout\//, "")],
  };
}

const CODE = {
  "pkg/src/infra/index.ts": "export * from './cache/index.js';\n",
  "pkg/src/infra/cache/index.ts": "export { memo } from './lru.js';\n",
  "pkg/src/infra/cache/lru.ts": "export function memo<T>(make: () => T): () => T {\n  return make;\n}\n",
};

const pin = (on: string, more: Partial<PinInput> = {}): PinInput => ({ anchor: parseAnchor(on)!, icon: "cache", label: "LRU cache", evidence: "lru.ts:1 memoises", commit: "0123abc", ...more });

test("9.1 · pin new records a lasting pin on a capability, a nested part of it or an exported name in one, with its icon, label, evidence and commit", async () => {
  const pins = shelf();
  const here = world(CODE);
  for (const on of [CACHE, `${CACHE}/pkg/src/infra/cache`, `${CACHE}/pkg/src/infra/cache#memo`, `${CACHE}#memo`]) {
    const written = await writePin(pins, here, pin(on));
    assert.ok(written.ok, on);
  }
  const kept = (await pins.list()).map(({ fields }) => fields);
  assert.deepEqual(kept.map(({ anchor }) => anchor), [
    { capability: CACHE },
    { capability: CACHE, part: "pkg/src/infra/cache" },
    { capability: CACHE, part: "pkg/src/infra/cache", name: "memo" },
    { capability: CACHE, name: "memo" },
  ]);
  assert.deepEqual({ ...kept[0], anchor: undefined, at: undefined }, { anchor: undefined, at: undefined, icon: "cache", label: "LRU cache", evidence: "lru.ts:1 memoises", commit: "0123abc" });
  assert.deepEqual(parseAnchor("store:postgres://db/app#users"), { store: "postgres://db/app", table: "users" });
  assert.equal(parseAnchor("not-a-capability"), undefined);
});

test("9.6 · pin new refuses an anchor that does not resolve, naming what is missing, and a fourth pin on one place, naming the three", async () => {
  const pins = shelf();
  const here = world(CODE);
  const refused = async (input: PinInput) => {
    const written = await writePin(pins, here, input);
    assert.ok(!written.ok);
    return written.refused;
  };
  assert.match(await refused(pin("capability_00000000000f")), /no capability capability_00000000000f is in the plan/);
  assert.match(await refused(pin(`${CACHE}/pkg/src/gone`)), /has no part pkg\/src\/gone/);
  assert.match(await refused(pin(`${CACHE}/pkg/src/infra/cache#forget`)), /no file of pkg\/src\/infra\/cache exports forget/);
  assert.match(await refused(pin("store:redis://cache")), /no shared store redis:\/\/cache is found \(the stores: postgres:\/\/db\/app\)/);
  assert.equal((await pins.list()).length, 0, "a refused pin writes nothing");

  const three = [];
  for (const label of ["One", "Two", "Three"]) {
    const written = await writePin(pins, here, pin(`${CACHE}/pkg/src/infra`, { label }));
    assert.ok(written.ok);
    three.push(written.pin.id);
  }
  const fourth = await refused(pin(`${CACHE}/pkg/src/infra#memo`, { label: "Four" }));
  assert.match(fourth, /holds 3 pins/);
  for (const id of three) assert.ok(fourth.includes(id), id);
  assert.ok((await writePin(pins, here, pin(`${CACHE}/pkg/src/infra/cache`))).ok, "a part inside it is a place of its own");
});

test("9.2 · pin list reads a pin stale, with why, once its part, name, capability or store no longer resolves, and never moves it", async () => {
  const pins = shelf();
  for (const on of [`${CACHE}/pkg/src/infra/cache#memo`, `${CACHE}/pkg/src/infra`, WEB, "store:postgres://db/app#users"]) assert.ok((await writePin(pins, world(CODE), pin(on, { icon: on.startsWith("store:") ? "store" : "cache" }))).ok);
  assert.deepEqual((await readPins(pins, world(CODE))).map(({ stale }) => stale), [undefined, undefined, undefined, undefined]);

  const renamed = { ...CODE, "pkg/src/infra/cache/index.ts": "export { remember } from './lru.js';\n", "pkg/src/infra/cache/lru.ts": "export function remember() {}\n" };
  const moved = world(Object.fromEntries(Object.entries(renamed).filter(([file]) => file !== "pkg/src/infra/index.ts")), [store("postgres://db/app")]);
  const read = await readPins(pins, { ...moved, capability: (id) => (id === WEB ? undefined : moved.capability(id)) });
  assert.deepEqual(read.map(({ stale }) => stale), [
    `${CACHE} has no part pkg/src/infra/cache`,
    `${CACHE} has no part pkg/src/infra`,
    `no capability ${WEB} is in the plan`,
    "postgres://db/app has no table users",
  ]);
  assert.deepEqual(read[0]!.pin.fields.anchor, { capability: CACHE, part: "pkg/src/infra/cache", name: "memo" }, "a stale pin keeps its anchor");

  const named = await readPins(pins, world(renamed));
  assert.equal(named[0]!.stale, "no file of pkg/src/infra/cache exports memo");
});

test("9.3 · each pin sits on the deepest drawn place holding it, rolled up with the count and icons, and a pin whose capability is not drawn is not placed", async () => {
  const pins = shelf();
  for (const [on, icon] of [[`${CACHE}/pkg/src/infra/cache#memo`, "cache"], [`${CACHE}/pkg/src/infra`, "config"], [CACHE, "flag"], [WEB, "api"]] as const) assert.ok((await writePin(pins, world(CODE), pin(on, { icon }))).ok);
  const all = await pins.list();
  const [memo, infra, whole] = all.map(({ id }) => id);

  const far = placePins(all, { capabilities: new Set([CACHE]) });
  assert.deepEqual(far, [{ place: { capability: CACHE }, count: 3, icons: ["cache", "config", "flag"], pins: [memo, infra, whole] }], "zoomed out, they roll up to the capability; the web capability is not drawn");

  const opened = placePins(all, { capabilities: new Set([CACHE, WEB]), parts: new Map([[CACHE, new Set(["pkg/src/infra"])]]) });
  assert.deepEqual(opened, [
    { place: { capability: CACHE, part: "pkg/src/infra" }, count: 2, icons: ["cache", "config"], pins: [memo, infra] },
    { place: { capability: CACHE }, count: 1, icons: ["flag"], pins: [whole] },
    { place: { capability: WEB }, count: 1, icons: ["api"], pins: [all[3]!.id] },
  ]);

  const near = placePins(all, { capabilities: new Set([CACHE]), parts: new Map([[CACHE, new Set(["pkg/src/infra", "pkg/src/infra/cache"])]]) });
  assert.deepEqual(near.map(({ place, pins: ids }) => [place, ids]), [
    [{ capability: CACHE, part: "pkg/src/infra/cache" }, [memo]],
    [{ capability: CACHE, part: "pkg/src/infra" }, [infra]],
    [{ capability: CACHE }, [whole]],
  ]);
});

test("9.4 · a pin on a shared store is placed on that store, never on a territory, and the store icon on a capability or part is refused naming the stores", async () => {
  const pins = shelf();
  const here = world(CODE, [store("postgres://db/app", ["users"]), store("redis://cache")]);
  const onCapability = await writePin(pins, here, pin(`${CACHE}/pkg/src/infra/cache`, { icon: "store" }));
  assert.ok(!onCapability.ok);
  assert.match(onCapability.refused, /stores' drawing.*store:postgres:\/\/db\/app, store:redis:\/\/cache/);
  assert.equal((await pins.list()).length, 0);

  assert.ok((await writePin(pins, here, pin("store:redis://cache", { label: "Session cache" }))).ok, "a cache that is a shared store is pinned on the store");
  assert.ok((await writePin(pins, here, pin("store:postgres://db/app#users", { icon: "store", label: "Accounts" }))).ok);
  const all = await pins.list();
  assert.deepEqual(all.map(({ fields }) => [fields.anchor, fields.icon]), [[{ store: "redis://cache" }, "cache"], [{ store: "postgres://db/app", table: "users" }, "store"]]);
  const placed = placePins(all, { capabilities: new Set([CACHE]), stores: new Set(["redis://cache", "postgres://db/app"]) });
  assert.deepEqual(placed.map(({ place }) => place), [{ store: "redis://cache" }, { store: "postgres://db/app" }]);
  assert.deepEqual(placePins(all, { capabilities: new Set([CACHE]) }), [], "with no store drawn, a store's pin goes on no territory");
});

test("9.5 · any agent may retire a pin with a reason: it leaves the list and frees its place; an id that is no live pin is refused", async () => {
  const pins = shelf();
  const ids = [];
  for (const label of ["One", "Two", "Three"]) {
    const written = await writePin(pins, world(CODE), pin(CACHE, { label }));
    assert.ok(written.ok);
    ids.push(written.pin.id);
  }
  assert.deepEqual(await retirePin(pins, ids[1]!, "the cache moved"), { ok: true });
  assert.equal(pins.retired.get(ids[1]!), "the cache moved");
  assert.deepEqual((await readPins(pins, world(CODE))).map(({ pin: { id } }) => id), [ids[0], ids[2]]);
  const four = await writePin(pins, world(CODE), pin(CACHE, { label: "Four" }));
  assert.ok(four.ok, "its place is free again");
  assert.deepEqual([four.pin.fields.anchor, four.pin.fields.label], [{ capability: CACHE }, "Four"]);
  assert.deepEqual((await pins.list()).map(({ fields }) => fields.label), ["One", "Three", "Four"]);
  assert.deepEqual(await retirePin(pins, ids[1]!, "again"), { ok: false, refused: `${ids[1]} is no live pin.` });
});

test("9.2 · a checkout's pin world gives each capability its own files and parts from its story's survey, from the folder a mapped story's paths are from", async () => {
  const stories = [{ id: "story_web", capabilities: [{ id: CACHE }, { id: WEB }] }, { id: "story_mapped", capabilities: [{ id: "capability_00000000000c" }] }];
  const nested = part("pkg/src/infra", ["pkg/src/infra/index.ts"]);
  const survey = {
    story_web: { files: [{ path: "pkg/src/infra/index.ts", lines: 1, capability: CACHE }, { path: "pkg/src/web.ts", lines: 1, capability: WEB }], imports: [], parts: { capabilities: { [CACHE]: [nested] }, clashes: [] } },
    story_mapped: { files: [{ path: "lib/a.py", lines: 1, capability: "capability_00000000000c" }], imports: [], mapped: { folder: "/imported" } },
  };
  const stores = [store("postgres://db/app")];
  const read = pinWorldOf(stories, survey, "/checkout", stores, async () => undefined);
  assert.deepEqual(read.capability(CACHE), { files: ["pkg/src/infra/index.ts"], parts: [nested], root: "/checkout" });
  assert.deepEqual(read.capability(WEB), { files: ["pkg/src/web.ts"], parts: [], root: "/checkout" });
  assert.deepEqual(read.capability("capability_00000000000c"), { files: ["lib/a.py"], parts: [], root: "/imported" });
  assert.equal(read.capability("capability_00000000000f"), undefined);
  assert.equal(read.stores, stores);
});
