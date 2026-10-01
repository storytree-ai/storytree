/** Capability 3 · Arc surface: the arc surface as the app's Surfaces menu lists and switches it, in a throwaway home. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readSurfaces, setSurface, surfaceOn } from "@storytree/app";

import { arcSurfaces } from "./surfaces.js";

test("3.8 the app's Surfaces menu lists the arc surface as Arcs, with no settings, on until the user switches it off; switched off, it is saved and reads off at the next launch", (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-arc-surfaces-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const [arcs] = readSurfaces(arcSurfaces, home);
  assert.deepEqual({ id: arcs!.id, name: arcs!.name, on: arcs!.on, switchable: arcs!.switchable, settings: arcs!.settings }, { id: "arcs", name: "Arcs", on: true, switchable: true, settings: [] });

  setSurface(arcSurfaces, ["arcs", "off"], home);
  assert.equal(surfaceOn(readSurfaces(arcSurfaces, home), "arcs"), false, "a fresh read, as the next launch makes, finds it off");
});
