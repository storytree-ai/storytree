// Capability 8 · Page bridge
import { composeParts } from "@storytree/plugin-loader";

import type { PageChannelMap } from "../page-operations.js";

export default await composeParts<PageChannelMap>(import.meta.url, "pageChannels");
