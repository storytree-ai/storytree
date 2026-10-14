/**
 * Capability 7 · Instructions. The other stories' sections of the habits card, as `#parts/guidance` names them run
 * unbundled: composed from the manifests of this package's dependencies by the plugin loader (ADR-1021). A bundle gets
 * the same list from the loader's build plugin instead, which answers `#parts/guidance` before this module is reached.
 */
import { composeParts } from "@storytree/plugin-loader";

export default await composeParts<string>(import.meta.url, "guidance");
