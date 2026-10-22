/**
 * Capability 3 · First-run guide. The factory folder picked on first launch (question_5867f490cdd6): storytree sets up
 * an empty folder's shape, a `plugins` folder the plugin loader reads each plugin from, and accepts one that has it.
 * A folder holding anything else is refused and left as it was. Hidden entries (a fresh repository's `.git`) do not
 * count, so a newly made private repo can be the factory.
 */
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { ChosenFactory } from "./bridge.js";

const PLUGINS = "plugins";

/** `folder` given the factory's shape when empty, or accepted when it has it; anything else is refused with why. */
export function shapeFactory(folder: string): ChosenFactory {
  if (statSync(path.join(folder, PLUGINS), { throwIfNoEntry: false })?.isDirectory()) return { status: "already a factory", folder };
  if (readdirSync(folder).some((entry) => !entry.startsWith("."))) {
    throw new Error(`${folder} holds other files and no plugins folder, so it is not a factory; choose an empty folder for storytree to set up, or one it set up before.`);
  }
  mkdirSync(path.join(folder, PLUGINS));
  return { status: "set up", folder };
}
