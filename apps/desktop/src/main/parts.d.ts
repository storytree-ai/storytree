/** The parts the plugin loader composes into the bundle from the story packages' manifests (build.mjs, ADR-1021). */
declare module "storytree:parts/surfaces" {
  const surfaces: readonly import("@storytree/app").SurfaceDeclaration[];
  export default surfaces;
}
