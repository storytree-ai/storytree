export interface WorkspacePackage {
  name: string;
  dir: string;
  deps: string[];
}

export type Workspace = WorkspacePackage[] & { rootDeps?: string[]; renderer?: string[] };

export type ScopeDecision = { mode: "full"; reason: string } | { mode: "affected"; dirs: string[]; reason: string };

export declare function readWorkspace(root: string): Workspace;
export declare function classify(files: readonly string[], workspace: Workspace): ScopeDecision;
