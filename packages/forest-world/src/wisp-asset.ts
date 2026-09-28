import { parseWisp, type WispGeometry } from './wisp-mesh.js';
import { DataTexture, LinearFilter } from 'three';

let model: Promise<WispGeometry> | undefined;

/** All engine and session wisps share one parse and one pair of GPU geometries. */
export function preloadWisp(): Promise<WispGeometry> {
  // esbuild still embeds the bytes. Delay the import so node-side canvas probes need no GLB loader.
  return model ??= import('../assets/wisp.glb').then(({ default: bytes }) => parseWisp(bytes));
}

let glow: DataTexture | undefined;

/** A shared procedural soft halo behind the solid model; never the body itself. */
export function wispGlow(): DataTexture {
  if (glow !== undefined) return glow;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.max(0, 1 - radius) ** 2);
    }
  }
  glow = new DataTexture(data, size, size);
  glow.magFilter = glow.minFilter = LinearFilter;
  glow.needsUpdate = true;
  return glow;
}
