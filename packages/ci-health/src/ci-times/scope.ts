// Capability 6 · CI times.
import { classify, readWorkspace } from "@storytree/base-dev-loop/test-scope";

import type { ScopeRule } from "./record.js";

export function ciScopeRule(folder: string): ScopeRule {
  const workspace = readWorkspace(folder);
  return (files) => {
    const decision = classify([...files], workspace);
    return "dirs" in decision ? { full: false, dirs: decision.dirs } : { full: true, dirs: [] };
  };
}
