// Capability 6 · Tool server (the MCP server)
import { composeParts } from "@storytree/plugin-loader";

import type { PipelineJob } from "../tools/server.js";

export default await composeParts<PipelineJob>(import.meta.url, "pipelineJobs");
