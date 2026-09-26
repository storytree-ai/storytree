import type { ForestScene, TreeForm } from "@storytree/forest";

import type { SceneStatus } from "../core/index.js";
import type { Descriptor3D } from "../world-to-3d.js";

export const GROUND_PER_PLACE = 0;

export function statusOf(_form: TreeForm): SceneStatus {
  return "unknown";
}

export function forestDescriptors(_scene: ForestScene): Descriptor3D[] {
  return [];
}
