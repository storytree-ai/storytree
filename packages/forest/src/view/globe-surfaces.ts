import type { Group } from "three";

/** The app's attention switches, also available to guides mounted outside the app. */
export type GlobeSurfaces = {
  sea: boolean; grounds: boolean; roads: boolean; nameplates: boolean;
  territories: false | "plain" | "health";
  fileCircles: boolean; knowledgeCore: boolean; sessionTints: boolean;
};

export function presentTerritories(group: Group, mode: GlobeSurfaces["territories"]): void {
  throw new Error("Territory presentation is not implemented");
}
