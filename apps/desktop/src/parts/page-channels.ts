/**
 * Capability 1 · Lifecycle. The page operations' channels, as `#parts/pageChannels` names them run unbundled: composed
 * from the manifests of this app's dependencies by the plugin loader (ADR-1021). The preload's bundle gets the same list
 * from the loader's build plugin instead (build.mjs). Data only, so the preload loads no story's main-process code.
 */
import { composeParts } from "@storytree/plugin-loader";

import type { PageChannelMap } from "../page-operations.js";

export default await composeParts<PageChannelMap>(import.meta.url, "pageChannels");
