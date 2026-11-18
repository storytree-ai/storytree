// Capability 8 · Page bridge
import { composeParts } from "@storytree/plugin-loader";

import type { PagePart } from "../../page-operations.js";

export default await composeParts<PagePart>(import.meta.url, "pageAnswers");
