// Capability 3 · Story node render
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Pin, PinReading } from "@storytree/map/pins";

import { badgeShown, markSpot, pinMarks } from "./pin-marks.js";

const CACHE = "capability_00000000000a";
const WEB = "capability_00000000000b";
const OFF = "capability_00000000000c";

const pin = (n: number, anchor: Pin["fields"]["anchor"], icon: Pin["fields"]["icon"], label: string, stale?: string): PinReading => ({
  pin: { id: `pin_${String(n).padStart(12, "0")}`, type: "pin", fields: { anchor, icon, label, evidence: "seen", commit: "abc", at: "2026-11-16T00:00:00.000Z" } } as unknown as Pin,
  ...(stale === undefined ? {} : { stale }),
});

const readings = [
  pin(1, { capability: CACHE, part: "pkg/src/infra/cache" }, "cache", "LRU cache of survey reads"),
  pin(2, { capability: CACHE, part: "pkg/src/infra/cache", name: "evict" }, "job", "Eviction sweep", "no file of pkg/src/infra/cache exports evict"),
  pin(3, { capability: CACHE }, "config", "Cache settings"),
  pin(4, { capability: WEB }, "api", "The public routes"),
  pin(5, { capability: OFF }, "auth", "Not on this map"),
  pin(6, { store: "postgres://db/app", table: "users" }, "store", "The users table"),
];

test("3.119 · zoomed out, a pin on a part rolls up to its capability's territory, which shows its pins' icons and how many; a pin whose capability is not drawn is not drawn", () => {
  const marks = pinMarks(readings, { capabilities: new Set([CACHE, WEB]) });
  assert.deepEqual(marks.map((mark) => [mark.key, mark.count, mark.pins.map(({ icon }) => icon)]), [
    [`${CACHE}/`, 3, ["cache", "job", "config"]],
    [`${WEB}/`, 1, ["api"]],
  ], "the cache capability holds its own pin and its part's two; WEB its one; OFF's is drawn nowhere, nor the store, which is not drawn");
  assert.deepEqual(marks[0]!.icons, ["cache", "job", "config"], "each icon once, in the pins' order");
  assert.equal(marks[0]!.stale, 1, "the stale pin is counted as stale");
});

test("3.119 · nearer, with the capability opened into its parts, the part's pins stand on the part, each with its label, a stale one marked stale; a store's pins on its slab", () => {
  const marks = pinMarks(readings, { capabilities: new Set([CACHE, WEB]), parts: new Map([[CACHE, new Set(["pkg/src/infra", "pkg/src/infra/cache"])]]), stores: new Set(["postgres://db/app"]) });
  const part = marks.find((mark) => mark.key === `${CACHE}/pkg/src/infra/cache`);
  assert.deepEqual(part?.pins.map(({ label, stale }) => [label, stale]), [["LRU cache of survey reads", undefined], ["Eviction sweep", "no file of pkg/src/infra/cache exports evict"]]);
  assert.deepEqual(marks.find((mark) => mark.key === `${CACHE}/`)?.pins.map(({ label }) => label), ["Cache settings"], "the capability keeps only its own pin once its part is drawn");
  assert.deepEqual(marks.find((mark) => mark.key === "store:postgres://db/app")?.pins.map(({ icon, label }) => [icon, label]), [["store", "The users table"]]);
});

test("3.119 · near, a mark shows a row per pin with its label, the stale one marked; far, each icon once, stale only when every pin bearing it is, and how many", () => {
  const [mark] = pinMarks(readings, { capabilities: new Set([CACHE]) });
  assert.deepEqual(badgeShown(mark!, true), { near: true, rows: mark!.pins });
  assert.deepEqual(badgeShown(mark!, false), { near: false, icons: [{ icon: "cache", stale: false }, { icon: "job", stale: true }, { icon: "config", stale: false }], count: 3 });
});

test("3.119 · a mark stands on its part's name once the part is drawn, else on its capability's; a store's on no island name, nor one whose name is not placed yet", () => {
  const plates = [{ capability: CACHE, x: 1, z: 2 }];
  const parts = [{ part: "pkg/src/infra/cache", x: 5, z: 6 }];
  assert.deepEqual(markSpot({ capability: CACHE }, plates, parts), { x: 1, z: 2 });
  assert.deepEqual(markSpot({ capability: CACHE, part: "pkg/src/infra/cache" }, plates, parts), { x: 5, z: 6 });
  assert.equal(markSpot({ capability: CACHE, part: "pkg/src/infra/cache" }, plates, undefined), undefined, "a part's mark waits for its name");
  assert.equal(markSpot({ capability: WEB }, plates, parts), undefined);
  assert.equal(markSpot({ store: "postgres://db/app" }, plates, parts), undefined);
});
