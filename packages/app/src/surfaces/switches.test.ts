/**
 * The Surfaces menu's readings (ADR-0750): every surface the stories declare, on and at its
 * defaults until you change it in the settings file, which a throwaway home holds here.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { readSurfaces, setSurface, type SurfaceDeclaration } from "./switches.js";

const declared: readonly SurfaceDeclaration[] = [
  { id: "globe", name: "Globe", description: "The planet.", switchable: false, settings: [
    { id: "opening-zoom", name: "Opening zoom", meaning: "How close it opens.", default: "whole", choices: [{ id: "whole", name: "Whole" }, { id: "close", name: "Close up" }] },
  ] },
  { id: "panel", name: "Panel", description: "The panel.", switchable: false, settings: [] },
  { id: "tree", within: "panel", name: "Tree", description: "The tree.", switchable: true, settings: [] },
  { id: "details", within: "panel", follows: "tree", name: "Details", description: "Picked in the tree.", switchable: false, settings: [] },
  { id: "sessions", name: "Sessions", description: "Who is working.", switchable: true, settings: [] },
];

function home(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-surfaces-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("3.7 with nothing saved, every surface is listed in order, on, with its settings at their defaults", (t) => {
  const read = readSurfaces(declared, home(t));
  assert.deepEqual(read.map(({ id, on, source }) => ({ id, on, source })), declared.map(({ id }) => ({ id, on: true, source: "default" })));
  assert.deepEqual(read[0]!.settings.map(({ id, value, source }) => ({ id, value, source })), [{ id: "opening-zoom", value: "whole", source: "default" }]);
  assert.equal(read[0]!.name, "Globe");
  assert.equal(read[0]!.description, "The planet.");
});

test("3.7 a surface switched off is saved in the settings file and reads off; one that follows it goes off with it", (t) => {
  const dir = home(t);
  setSurface(declared, ["tree", "off"], dir);
  setSurface(declared, ["globe", "opening-zoom", "close"], dir);
  const read = new Map(readSurfaces(declared, dir).map((surface) => [surface.id, surface]));
  assert.equal(read.get("tree")!.on, false);
  assert.equal(read.get("tree")!.source, "set");
  assert.equal(read.get("details")!.on, false, "details are picked in the tree, so they go with it");
  assert.equal(read.get("sessions")!.on, true);
  assert.equal(read.get("globe")!.settings[0]!.value, "close");
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8")), { surfaces: { tree: { on: false }, globe: { "opening-zoom": "close" } } });
  setSurface(declared, ["tree", "on"], dir);
  assert.equal(readSurfaces(declared, dir).find(({ id }) => id === "details")!.on, true);
});

test("3.7 switching an always-on surface, an unknown surface or an unknown choice is refused with its reason, the file untouched", (t) => {
  const dir = home(t);
  assert.throws(() => setSurface(declared, ["globe", "off"], dir), /Globe is always on/);
  assert.throws(() => setSurface(declared, ["moon", "off"], dir), /no surface "moon".*globe/);
  assert.throws(() => setSurface(declared, ["sessions", "maybe"], dir), /on or off/);
  assert.throws(() => setSurface(declared, ["globe", "opening-zoom", "far"], dir), /whole, close/);
  assert.throws(() => setSurface(declared, ["globe", "tilt", "up"], dir), /no setting "tilt"/);
  assert.deepEqual(readSurfaces(declared, dir).map(({ on }) => on), [true, true, true, true, true]);
});
