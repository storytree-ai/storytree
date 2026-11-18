// Capability 3 · Surfaces
import { composeParts } from "@storytree/plugin-loader";

export interface NamedSurface {
  readonly id: string;
  readonly name: string;
}

export default await composeParts<NamedSurface>(import.meta.url, "namedSurfaces");
