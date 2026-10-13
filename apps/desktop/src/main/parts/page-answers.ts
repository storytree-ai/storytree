/**
 * Capability 1 · Lifecycle. The page operations' answers, as `#parts/pageAnswers` names them run unbundled: composed from
 * the manifests of this app's dependencies by the plugin loader (ADR-1021). The app's bundle gets the same list from the
 * loader's build plugin instead (build.mjs).
 */
import { composeParts } from "@storytree/plugin-loader";

import type { PagePart } from "../../page-operations.js";

export default await composeParts<PagePart>(import.meta.url, "pageAnswers");
