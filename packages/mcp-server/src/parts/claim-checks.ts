// Capability 6 · Tool server (the MCP server)
import { composeParts } from "@storytree/plugin-loader";

import type { ClaimCheck } from "../tools/server.js";

export default await composeParts<ClaimCheck>(import.meta.url, "claimChecks");
