/**
 * The `storytree` command on the user's path (ADR-0643 D1, 8), and whether GitHub's `gh` is signed
 * in, which release on merge needs (D3).
 *
 * - The command is a small launcher, `storytree` (a shell script) or `storytree.cmd` on Windows,
 *   that runs the `storytree.mjs` built beside the hook and tool server scripts with the same Node.
 *   What that command does is the command line's own story (`0-3-cli-story-tree`); this only puts
 *   it where the user can run it.
 * - It goes into the first folder on the PATH that is inside the user's home and can be written
 *   (such as ~/.local/bin, or npm's folder on Windows), so nothing outside their home is touched and
 *   no setting of theirs is changed. With no such folder, it is put nowhere and the check says so.
 * - It is recognised as storytree's by a marker line inside it. A `storytree` anywhere on the path
 *   that is not storytree's is the user's own, and is kept: storytree neither replaces nor shadows it.
 */
import { execFile } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

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

/** The line that marks a launcher as storytree's own. */
const MARKER = "storytree 0.3's command (put here by its setup check)";
/** The launcher's file name on this machine. */
const FILE = process.platform === "win32" ? "storytree.cmd" : "storytree";

/** Put a `storytree` command running `target` with `node` on the path. */
export function putCommandOnPath(where: CommandPath, node: string, target: string): CommandInstall {
  const launcher = launcherFor(node, target);
  const found = onPath(where).map((folder) => path.join(folder, FILE)).filter((file) => existsSync(file));
  const ours = found.filter(isOurs);
  if (found.some((file) => !isOurs(file))) return "another storytree kept";
  if (ours.length > 0) {
    const [file] = ours;
    if (readFileSync(file!, "utf8") === launcher) return "already installed";
    writeLauncher(file!, launcher); // an older install's, pointing elsewhere
    return "installed";
  }
  const folder = onPath(where).find((candidate) => inside(candidate, where.home) && writable(candidate));
  if (folder === undefined) return "no folder of the user's on the path";
  writeLauncher(path.join(folder, FILE), launcher);
  return "installed";
}

/** Take storytree's `storytree` command off the path, leaving any other. */
export function removeCommand(where: CommandPath): "removed" | "none" {
  const ours = onPath(where)
    .map((folder) => path.join(folder, FILE))
    .filter((file) => existsSync(file) && isOurs(file));
  for (const file of ours) rmSync(file, { force: true });
  return ours.length > 0 ? "removed" : "none";
}

/** Whether `gh` is installed and signed in, as `gh auth status` says. */
export function ghState(): Promise<GhState> {
  return new Promise((resolve) => {
    execFile("gh", ["auth", "status"], { timeout: 5_000, windowsHide: true }, (error) => {
      if (error === null) return resolve("signed in");
      resolve((error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "signed out");
    });
  });
}

/** The launcher's text: run `target` with `node`, passing every argument on. */
function launcherFor(node: string, target: string): string {
  // A missing GOTO label ends the batch before Node runs: setup remove can delete this file.
  // The same parsed line hands off to Node and keeps its exit code (npm/cmd-shim's handoff).
  return process.platform === "win32"
    ? `@echo off\r\nrem ${MARKER}\r\ngoto #_storytree_handoff_# 2>nul || "${node}" "${target}" %*\r\n`
    : `#!/bin/sh\n# ${MARKER}\nexec "${node}" "${target}" "$@"\n`;
}

function writeLauncher(file: string, launcher: string): void {
  writeFileSync(file, launcher);
  if (process.platform !== "win32") chmodSync(file, 0o755);
}

function isOurs(file: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(MARKER);
  } catch {
    return false;
  }
}

/** The folders on the PATH, in order, that exist. */
function onPath(where: CommandPath): string[] {
  return where.path
    .split(path.delimiter)
    .filter((folder) => folder !== "")
    .filter((folder) => {
      try {
        return statSync(folder).isDirectory();
      } catch {
        return false;
      }
    });
}

function inside(folder: string, home: string): boolean {
  const relative = path.relative(path.resolve(home), path.resolve(folder));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function writable(folder: string): boolean {
  try {
    accessSync(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
