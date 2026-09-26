/**
 * The `storytree` command on the user's path (ADR-0643 D1, 8), and whether GitHub's `gh` is signed
 * in for release on merge (D3).
 */

/** Where the `storytree` command may go: the PATH to look along, and the user's home, which the folder must be inside. */
export interface CommandPath {
  /** The PATH, as the environment gives it. */
  readonly path: string;
  readonly home: string;
}

/** What putting the command on the path found. */
export type CommandInstall = "installed" | "already installed" | "another storytree kept" | "no folder of the user's on the path";

/** Whether GitHub's `gh` is there and signed in. */
export type GhState = "signed in" | "signed out" | "missing";

/** Put a `storytree` command running `target` with `node` on the path. */
export function putCommandOnPath(_where: CommandPath, _node: string, _target: string): CommandInstall {
  return "no folder of the user's on the path";
}

/** Take storytree's `storytree` command off the path, leaving any other. */
export function removeCommand(_where: CommandPath): "removed" | "none" {
  return "none";
}

/** Whether `gh` is installed and signed in. */
export async function ghState(): Promise<GhState> {
  return "signed in";
}
