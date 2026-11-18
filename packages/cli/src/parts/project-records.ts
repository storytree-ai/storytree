// Capability 1 · Front door
import { composeParts } from "@storytree/plugin-loader";

import type { ProjectRecords } from "../mount.js";

export default await composeParts<ProjectRecords>(import.meta.url, "projectRecords");
