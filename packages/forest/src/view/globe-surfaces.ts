import type { Group, Mesh, MeshBasicMaterial, Object3D } from "three";

/** The app's attention switches, also available to guides mounted outside the app. */
export type GlobeSurfaces = {
  sea: boolean; grounds: boolean; roads: boolean; nameplates: boolean;
  territories: false | "plain" | "health";
  fileCircles: boolean; knowledgeCore: boolean; sessionTints: boolean;
};

const healthOpacity = new WeakMap<Mesh, number>();
const presentation = new WeakMap<Object3D, GlobeSurfaces["territories"]>();

export function presentTerritories(group: Group, mode: GlobeSurfaces["territories"]): void {
  presentation.set(group, mode);
  for (const mark of group.children) {
    if (mark.name.startsWith("territory:")) {
      mark.visible = mode !== false;
      const mesh = mark as Mesh, material = mesh.material as MeshBasicMaterial;
      if (!healthOpacity.has(mesh)) healthOpacity.set(mesh, material.opacity);
      material.opacity = mode === "plain" ? 0 : healthOpacity.get(mesh)!;
    } else if (mark.name === "territory-borders" || mark.name.startsWith("territory-hatch:")) {
      mark.visible = mode !== false;
    }
  }
}

/** Session emphasis replaces materials temporarily; restoring one also restores the current presentation. */
export function restoreTerritoryPresentation(root: Object3D): void {
  root.traverse(object => {
    const mode = presentation.get(object);
    if (mode !== undefined) presentTerritories(object as Group, mode);
  });
}
