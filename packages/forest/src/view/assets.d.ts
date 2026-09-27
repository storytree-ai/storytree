// The build bundles .glb files into the page as their bytes (build.mjs, esbuild's binary loader).
declare module "*.glb" {
  const bytes: Uint8Array;
  export default bytes;
}
