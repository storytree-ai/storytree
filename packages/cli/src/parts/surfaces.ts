// Capability 1 · Front door
import type { SurfaceDeclaration } from "../mount.js";
import { composeParts } from "@storytree/plugin-loader";

export default await composeParts<SurfaceDeclaration>(import.meta.url, "surfaces");
