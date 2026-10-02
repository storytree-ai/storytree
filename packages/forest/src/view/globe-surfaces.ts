import type { Group, Mesh, MeshBasicMaterial } from "three";

/** The app's attention switches, also available to guides mounted outside the app. */
export type GlobeSurfaces = {
  sea: boolean; grounds: boolean; roads: boolean; nameplates: boolean;
  territories: false | "plain" | "health";
  fileCircles: boolean; knowledgeCore: boolean; sessionTints: boolean;
};

const healthOpacity = new WeakMap<MeshBasicMaterial, number>();

export function presentTerritories(group: Group, mode: GlobeSurfaces["territories"]): void {
  for (const mark of group.children) {
    if (mark.name.startsWith("territory:")) {
      mark.visible = mode !== false;
      const material = (mark as Mesh).material as MeshBasicMaterial;
      if (!healthOpacity.has(material)) healthOpacity.set(material, material.opacity);
      material.opacity = mode === "plain" ? 0 : healthOpacity.get(material)!;
    } else if (mark.name === "territory-borders" || mark.name.startsWith("territory-hatch:")) {
      mark.visible = mode !== false;
    }
  }
}

export function restoreTerritoryPresentation(group: Group): void {}
