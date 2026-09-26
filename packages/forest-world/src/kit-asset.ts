// kit-asset.ts — THE BOUGHT KIT'S EXPORT, NAMED. Ported from 0.2's `kit-asset.ts`, which embedded
// the `.glb` as a base64 literal because 0.2's web sync carried only `.ts`. 0.3 has no web sync (the
// website mount was cut, ADR-0635 c3), so the export ships ONCE, as `assets/dressing-kit.glb` beside
// this package: the page bundles it as bytes (esbuild's binary loader, `apps/desktop/build.mjs`) and
// hands them to `loadEmbeddedKit`, and tests read the same file from disk (`testing/kit-bytes.ts`).
// Only this export of the bought pine kit ships, never the kit itself (ADR-0418).

/** SHA-256 of `assets/dressing-kit.glb`, the kit export 0.2 shipped (ADR-0508 D1's native rung). */
export const KIT_ASSET_SHA256 = '9479bc812b0be9491989924eb0814b7e7f15912ffc92314db05697a5922fa31a';

/** Bytes of the `.glb` itself. */
export const KIT_ASSET_BYTES = 1782636;
