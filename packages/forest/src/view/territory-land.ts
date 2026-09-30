import { Group } from "three";
import type { IslandLand } from "@storytree/forest-world/scene";
export function territoryLand(_land: IslandLand, _onSurface: (point: { x: number; z: number }) => import("three").Vector3): Group { return new Group(); }
