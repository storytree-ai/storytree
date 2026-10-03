import type { Group, Mesh, MeshBasicMaterial, Object3D } from "three";

/** The app's attention switches, also available to guides mounted outside the app. */
export type GlobeSurfaces = {
  sea: boolean; grounds: boolean; roads: boolean; nameplates: boolean;
  territories: false | "plain" | "health";
  fileCircles: boolean; knowledgeCore: boolean; sessionTints: boolean;
};

const healthOpacity = new WeakMap<Mesh, number>();
const presentation = new WeakMap<Object3D, GlobeSurfaces["territories"]>();
/** How far each territory has filled in on a growing globe (3.30); absent is whole. */
const grownBy = new WeakMap<Object3D, number>();
/** Each file circle's full size, before the growth swells it. */
const fullSize = new WeakMap<Object3D, number>();

export function presentTerritories(group: Group, mode: GlobeSurfaces["territories"]): void {
  presentation.set(group, mode);
  for (const mark of group.children) {
    if (mark.name.startsWith("territory:")) {
      const grown = grownBy.get(mark) ?? 1;
      mark.visible = mode !== false && grown > 0;
      const mesh = mark as Mesh, material = mesh.material as MeshBasicMaterial;
      if (!healthOpacity.has(mesh)) healthOpacity.set(mesh, material.opacity);
      material.opacity = mode === "plain" ? 0 : healthOpacity.get(mesh)! * grown;
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

/**
 * An island's land on a growing globe (3.30): each capability's territory fills in, and each file circle swells
 * from its middle, by how far the globe's growth has brought it; at 1 each is exactly as drawn without one.
 * The territory switches still hold. Returns whether everything is whole.
 */
export function growLand(land: Group, circles: Group, grown: { capability(capability: string): number; file(path: string): number }): boolean {
  let whole = true;
  for (const mark of land.children) {
    const capability = mark.userData.capability;
    if (!mark.name.startsWith("territory:") || typeof capability !== "string") continue;
    const progress = grown.capability(capability);
    grownBy.set(mark, progress);
    whole &&= progress >= 1;
  }
  presentTerritories(land, presentation.get(land) ?? "health");
  for (const circle of circles.children) {
    const path = circle.userData.file;
    if (typeof path !== "string") continue;
    if (!fullSize.has(circle)) fullSize.set(circle, circle.scale.x);
    const progress = grown.file(path);
    circle.visible = progress > 0;
    circle.scale.setScalar(fullSize.get(circle)! * Math.max(progress, 0.001));
    whole &&= progress >= 1;
  }
  return whole;
}
