import { Mesh, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface WispGeometry {
  core: BufferGeometry;
  shell: BufferGeometry;
}

/** Parse the bundled Blender model; bake glTF node transforms into the shared geometry. */
export async function parseWisp(bytes: Uint8Array): Promise<WispGeometry> {
  const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const geometry = (name: string): BufferGeometry => {
    const mesh = gltf.scene.getObjectByName(name);
    if (!(mesh instanceof Mesh)) throw new Error(`Wisp model is missing ${name}`);
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    // Each mounted wisp supplies its own tint; the asset's preview materials are not drawn.
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    return mesh.geometry;
  };
  return { core: geometry('WispCore'), shell: geometry('WispShell') };
}
