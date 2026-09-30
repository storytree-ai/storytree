import type { ForestScene } from "@storytree/forest-world/scene";

/** Public drawing data only. Never serialize a library record or an activity line here. */
export interface ForestSnapshot {
  version: 1;
  capturedAt: string;
  radius: number;
  scene: ForestScene;
  spots: [string, { x: number; y: number; z: number }][];
}
