// detail-normal-texture.ts — THE BROWSER HALF OF THE CLIFF NORMAL MAP: the embedded PNG as a
// tiling `three` texture, and the two recipe numbers that say how it is applied.
//
// LAYER 6 of the approved ground material (build_land.py `mat_attribute()` :943-965): the bought
// kit's cliff NORMAL map as a DETAIL layer — "its relief, not its colour". The bytes live in
// `detail-normal.ts` (pure, provable under `bun test`); this module is the one that imports
// `three` and hands the browser a `data:` URL to decode, kept separate the way `kit-mesh.ts` is
// kept from `kit-asset.ts`.
//
// ⚠ THE TILE IS 2.4 GROUND UNITS, NOT 2.5. The recipe's Mapping node scales the UV by 2.5
// (:946), but the plane's UV is `xy / 6.0` (`build_land_grid`, :605-606), so one repeat of the
// map covers 6.0 / 2.5 = 2.4 ground units — which is what the recipe's own comment calls "~2.4
// ground units" (:944). Reading the Mapping scale as the tile is the off-by-a-UV-scale trap.
//
// ⚠ THE STRENGTH IS PROVENANCE, NOT THE SHIPPED VALUE. The recipe holds NormalMap strength at
// 0.30 and names its limit (:958-961): at 0.55 the cliff map's directional striation shows
// through the grass as WHORLS, and the tiling with it. Under ADR-0503 the shipped strength is
// chosen from a rendered ladder by the look, so the material takes `strength` as an OPTION and
// this constant is the ladder's provenance rung, never a baked taste value.

import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture,
  TextureLoader,
} from 'three';

import { LAND_SCALE } from './land-per-capability.js';
import { DETAIL_NORMAL_PNG_BASE64 } from './detail-normal.js';
import { applyRawColourConvention } from './texture-convention.js';

/** Ground units one repeat of the tile covers: the plane's UV is `xy / 6.0` and the recipe's
 *  Mapping scale is 2.5, so 6.0 / 2.5. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const DETAIL_TILE_UNITS = 2.4 * LAND_SCALE;

/** The recipe's NormalMap strength (:958-961) — provenance only; the shipped strength is an
 *  option chosen from a rendered ladder. */
export const DETAIL_STRENGTH_RECIPE = 0.3;

/** The embedded PNG as a URL the browser's image decoder accepts. */
const DETAIL_NORMAL_DATA_URL = 'data:image/png;base64,' + DETAIL_NORMAL_PNG_BASE64;

/** The name a headless-built detail texture carries, so a scene built under node can be told
 *  from one that decoded the map. */
export const HEADLESS_DETAIL_NAME = 'detail-normal:headless';

/** An image-less `Texture` for a caller with no `document` — see {@link detailNormalTexture}. */
export function headlessDetailTexture(): Texture {
  const tex = new Texture();
  tex.name = HEADLESS_DETAIL_NAME;
  return tex;
}

/**
 * The cliff normal map as a REPEATING, LINEAR-DATA, MIPMAPPED texture.
 *
 * `TextureLoader.load` returns the `Texture` synchronously and fills its image asynchronously
 * (the browser decodes the `data:` URL); the material may bind it at once and the tile appears
 * on the frame the decode lands. `NoColorSpace` because a normal map is data, not colour — the
 * default sRGB decode would bend every vector. `RepeatWrapping` because the fragment stage
 * samples it at `vWorld.xz / tile`, well outside [0, 1]. Mipmapped with trilinear minification
 * because a 128 tile at 2.4 ground units is read at many texels per pixel at the zoomed-out
 * frame, where an unfiltered normal map shimmers.
 */
export function detailNormalTexture(): Texture {
  // ⚠ HEADLESS CALLERS GET THE SAME TEXTURE WITH NO IMAGE. `TextureLoader` decodes through an
  // `<img>`, which needs a `document`; the frame-cost and comparison pages build the SHIPPED
  // scene under node to read its PLAN (triangles, octaves, the arms' byte-identity), and there
  // the material only needs a `Texture` object to bind. So under node the flags are set on an
  // empty `Texture` and nothing is decoded — the bytes are the same 26 KB either way, and the
  // browser is the only place a pixel is ever read from them. Named on the object so a frame
  // captured from a headless-built scene can never pass as one that wore the map.
  const tex = typeof document === 'undefined' ? headlessDetailTexture() : new TextureLoader().load(DETAIL_NORMAL_DATA_URL);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  // ⚠ ROUTED THROUGH THE COLOUR CONVENTION AS A DATA MAP, AND THE TEXTURE CARRIES THE RECORD.
  // Every loader on this surface passes through `applyRawColourConvention`
  // (`harness/texture-convention.test.ts` scans for the call); a normal map is a DATA slot there,
  // which the convention deliberately leaves alone — the `NoColorSpace` above is that same
  // statement made on the texture itself. Because the convention CHANGES nothing on a data map,
  // the routing is invisible on the texture — a call handed an empty material would leave it
  // byte-identical — so the application's own report is written onto `userData` (three's
  // plain-object bag for exactly this), where a test or a scene inspector reads that this
  // texture was routed as a data map rather than assuming it.
  const application = applyRawColourConvention({ normalMap: tex });
  tex.userData['colourConvention'] = application.dataSlots;
  return tex;
}
