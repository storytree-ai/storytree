// Capability 4 · Updates
import { buildLabel } from "@storytree/app";

declare const STORYTREE_BUILD_COMMIT: string | undefined;

export function packagedBuild(version: string): string {
  const commit = typeof STORYTREE_BUILD_COMMIT === "undefined" ? undefined : STORYTREE_BUILD_COMMIT;
  return buildLabel({ appPath: "", packaged: { version, ...(commit === undefined ? {} : { commit }) } });
}
