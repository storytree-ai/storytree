// Capability 1 · Front door
import { composeParts } from "@storytree/plugin-loader";

import type { ArmCheck } from "../mount.js";

export default await composeParts<ArmCheck>(import.meta.url, "armChecks");
