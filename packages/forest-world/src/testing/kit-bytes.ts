// The kit export as the tests read it: the same `assets/dressing-kit.glb` the page bundles, from
// disk. It stands in for 0.2's `decodeKitAsset`, which decoded an embedded base64 copy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The committed `.glb`, as the `ArrayBuffer` `GLTFLoader.parseAsync` wants. */
export function decodeKitAsset(): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(new URL('../../assets/dressing-kit.glb', import.meta.url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
