// Capability 6 · Tool server (the MCP server)
import { composeParts } from "@storytree/plugin-loader";

import type { ToolPart } from "../tools/server.js";

export default await composeParts<ToolPart>(import.meta.url, "tools");
