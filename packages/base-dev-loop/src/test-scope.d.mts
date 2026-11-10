// Types for the TypeScript consumers of test-scope.mjs (CI health's open pull request scopes, 6.9): only what they use.

/** A workspace package as readWorkspace reads it: its name, its dir (repo-relative, posix) and the workspace packages it names. */
export interface WorkspacePackage {
  name: string;
  dir: string;
  deps: string[];
}

/** The workspace packages, with which of them the root package.json depends on. */
export type Workspace = WorkspacePackage[] & { rootDeps?: string[]; renderer?: string[] };

/** The decision `pnpm test` and CI run by: every package, or the package dirs a change can reach. */
export type ScopeDecision = { mode: "full"; reason: string } | { mode: "affected"; dirs: string[]; reason: string };

export declare function readWorkspace(root: string): Workspace;
export declare function classify(files: readonly string[], workspace: Workspace): ScopeDecision;
