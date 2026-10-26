/**
 * Capability 6 · Agent tools. The pipeline jobs the other stories contribute (ADR-1170 D2), as `#parts/pipelineJobs`
 * names them run unbundled: composed from the manifests of this package's dependencies by the plugin loader (ADR-1021),
 * and handed to App setup's wire_pipeline. A bundle gets the same list from the loader's build plugin instead, which
 * answers `#parts/pipelineJobs` first.
 */
import { composeParts } from "@storytree/plugin-loader";

import type { PipelineJob } from "../tools/server.js";

export default await composeParts<PipelineJob>(import.meta.url, "pipelineJobs");
