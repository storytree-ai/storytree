// Capability 1 · Front door
import type { VerbFamily } from "@storytree/library/verbs";
import { composeParts } from "@storytree/plugin-loader";

import type { CommandCaller, CommandPlace } from "../mount.js";

export default await composeParts<VerbFamily<CommandCaller & CommandPlace>>(import.meta.url, "verbs");
