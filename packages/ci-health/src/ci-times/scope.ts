/**
 * Capability 6 · CI times. The scope rule an open pull request's checks estimate is read by: the one `pnpm test` and CI
 * decide by (base-dev-loop's test scoping), over the checkout the recording runs from, so a pull request's packages are its
 * changed files' packages and every package that depends on them, or every package when a change cannot be mapped.
 */
import { classify, readWorkspace } from "@storytree/base-dev-loop/test-scope";

import type { ScopeRule } from "./record.js";

/** CI's scope rule over the workspace at `folder`. */
export function ciScopeRule(folder: string): ScopeRule {
  const workspace = readWorkspace(folder);
  return (files) => {
    const decision = classify([...files], workspace);
    return "dirs" in decision ? { full: false, dirs: decision.dirs } : { full: true, dirs: [] };
  };
}
