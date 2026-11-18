// Capability 18 · Built commands.
import { composeParts } from "@storytree/plugin-loader";
import type { HOOK_COMMANDS } from "@storytree/session-management/hook-command";

export default await composeParts<(typeof HOOK_COMMANDS)[number]>(import.meta.url, "hooks");
