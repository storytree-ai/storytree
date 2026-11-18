// Capability 6 · Tool server (the MCP server)
import type { VerbFamily } from "@storytree/library/verbs";
import { composeParts } from "@storytree/plugin-loader";

import type { ToolContext } from "../tools/mount.js";

export default await composeParts<VerbFamily<ToolContext>>(import.meta.url, "verbs");
