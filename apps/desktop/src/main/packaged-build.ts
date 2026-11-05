/**
 * Capability 4 · Updates. A packaged build's label, naming the commit the bundle was stamped with (contract 4.39), so
 * it is known from the first moment: an error recorded before the app is ready names that commit too.
 */
import { buildLabel } from "@storytree/app";

declare const STORYTREE_BUILD_COMMIT: string | undefined;

/** `version 0.3.0 (commit 9fa208b)`, or only the version when the bundle was stamped with no commit. */
export function packagedBuild(version: string): string {
  const commit = typeof STORYTREE_BUILD_COMMIT === "undefined" ? undefined : STORYTREE_BUILD_COMMIT;
  return buildLabel({ appPath: "", packaged: { version, ...(commit === undefined ? {} : { commit }) } });
}
