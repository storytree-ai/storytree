/**
 * Capability 8 · Setup check. The hook commands its story packages declare, as `#parts/hooks` names them run unbundled:
 * composed from the manifests of this package's dependencies by the plugin loader (ADR-1021). The built hook command
 * gets the same list from the loader's build plugin instead (bins/build.ts).
 */
import { composeParts } from "@storytree/plugin-loader";
import type { HOOK_COMMANDS } from "@storytree/session-management/hook-command";

export default await composeParts<(typeof HOOK_COMMANDS)[number]>(import.meta.url, "hooks");
