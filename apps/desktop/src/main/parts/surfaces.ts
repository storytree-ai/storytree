// Capability 3 · Surfaces
import type { SurfaceDeclaration } from "@storytree/app";
import { composeParts } from "@storytree/plugin-loader";

export default await composeParts<SurfaceDeclaration>(import.meta.url, "surfaces");
