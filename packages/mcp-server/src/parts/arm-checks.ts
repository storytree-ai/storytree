// Capability 6 · Tool server (the MCP server)
import { composeParts } from "@storytree/plugin-loader";

import type { ArmCheck } from "../tools/server.js";

export default await composeParts<ArmCheck>(import.meta.url, "armChecks");
