/**
 * The `storytree` command on the user's path (ADR-0643 D1, 8), and whether GitHub's `gh` is signed
 * in, which release on merge needs (D3).
 *
 * - The command is a small launcher that runs the `storytree.mjs` built beside the hook and tool
 *   server scripts with the same Node: a shell script, `storytree`, or on Windows `storytree.exe`, a
 *   program of its own built beside the scripts (./launcher.c), which hands every word on as the
 *   caller's command line spelled it; a batch file cannot, since cmd.exe reads its words as its own
 *   syntax (ADR-0854). What the command does is the command line's own story (`0-3-cli-story-tree`);
 *   this only puts it where the user can run it. The installer's command (app setup 1) is the same launcher.
 * - It goes into the first folder on the PATH that is inside the user's home and can be written
 *   (such as ~/.local/bin, or npm's folder on Windows), so nothing outside their home is touched and
 *   no setting of theirs is changed. With no such folder, it is put nowhere and the check says so.
 *   Storytree's own launcher outside the home (another home's install) is left alone by install and remove.
 * - It is recognised as storytree's by a marker line inside it. A `storytree` anywhere on the path
 *   that is not storytree's is the user's own, and is kept: storytree neither replaces nor shadows it.
 *   The batch launcher storytree wrote on Windows before ADR-0854, `storytree.cmd`, is still its own,
 *   and is replaced by the program in its folder.
 */
import { spawn } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ask, pathEnv, type MachineOptions } from "./machine.js";

/** Where the `storytree` command may go: the PATH to look along, and the user's home, which the folder must be inside. */
export interface CommandPath {
  /** The PATH, as the environment gives it. */
  readonly path: string;
  readonly home: string;
}

/** What putting the command on the path found; repointing an older launcher names it and what it ran. */
export type CommandInstall =
  | "installed"
  | `installed (replaced ${string}, which ran ${string})`
  | "already installed"
  | "another storytree kept"
  | "no folder of the user's on the path";

/** Whether GitHub's `gh` is there and signed in. */
export type GhState = "signed in" | "signed out" | "missing" | "not answering";

/** What a launcher of storytree's runs. */
export interface LauncherRuns {
  readonly node: string;
  readonly target: string;
}

/** The line that marks a launcher as storytree's own. */
const MARKER = "storytree 0.3's command (put here by its setup check)";
/** The program a Windows launcher is made from, built beside the scripts it runs (../bins/launcher.ts). */
const PROGRAM = "storytree-launcher.exe";
/** What ends the text appended to that program: the text's length, then these four bytes. */
const TRAILER = "stlr";

/** The launcher's file name on a system. */
export function launcherFile(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "storytree.exe" : "storytree";
}

/** Every name a launcher of storytree's has had on a system: on Windows also the batch file it was before ADR-0854. */
export function launcherFiles(platform: NodeJS.Platform = process.platform): string[] {
  return platform === "win32" ? ["storytree.exe", "storytree.cmd"] : ["storytree"];
}

/**
 * The launcher that runs `target` with `node`. On Windows it is the program built beside `target`
 * with the marker, Node and `target` appended to it, one line each; elsewhere a shell script.
 */
export function launcherFor(node: string, target: string, platform: NodeJS.Platform = process.platform): Buffer {
  if ([node, target].some((value) => /[\r\n"]/.test(value))) throw new Error("Command paths contain an unsupported quote or newline");
  if (platform !== "win32") {
    const quote = (value: string) => `"${value.replace(/[\\$`]/g, "\\$&")}"`;
    return Buffer.from(`#!/bin/sh\n# ${MARKER}\nexec ${quote(node)} ${quote(target)} "$@"\n`);
  }
  const program = path.join(path.dirname(target), PROGRAM);
  if (!existsSync(program)) throw new Error(`There is no ${PROGRAM} beside ${target} to make storytree's Windows command from: build storytree on Windows, where its build makes one.`);
  const text = Buffer.from(`${MARKER}\n${node}\n${target}\n`, "utf8");
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(text.length, 0);
  trailer.write(TRAILER, 4, "latin1");
  return Buffer.concat([readFileSync(program), text, trailer]);
}

/** What a launcher of storytree's runs, read back from its file; undefined when the file is not one. */
export function launcherRuns(file: string): LauncherRuns | undefined {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    return undefined;
  }
  if (bytes.length > 8 && bytes.toString("latin1", bytes.length - 4) === TRAILER) {
    const length = bytes.readUInt32LE(bytes.length - 8);
    if (length > bytes.length - 8) return undefined;
    const [marker, node, target] = bytes.toString("utf8", bytes.length - 8 - length, bytes.length - 8).split("\n");
    return marker === MARKER && node && target ? { node, target } : undefined;
  }
  const text = bytes.toString("utf8");
  if (!text.includes(MARKER)) return undefined;
  // A shell script escapes \, $ and ` in its paths; a batch file doubled each %.
  const script = /exec "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)" "\$@"/.exec(text);
  if (script !== null) return { node: script[1]!.replace(/\\(.)/g, "$1"), target: script[2]!.replace(/\\(.)/g, "$1") };
  const batch = /"([^"]*)" "([^"]*)" %\*/.exec(text);
  return batch === null ? undefined : { node: batch[1]!.replaceAll("%%", "%"), target: batch[2]!.replaceAll("%%", "%") };
}

/**
 * Write a launcher, replacing what is there. A running program on Windows can be renamed but not
 * overwritten or deleted, so one in use is set aside and deleted once it exits (ADR-0854 D3).
 */
export function writeLauncher(file: string, launcher: Buffer): void {
  sweep(file);
  const next = `${file}.${process.pid}.new`;
  writeFileSync(next, launcher);
  if (process.platform !== "win32") chmodSync(next, 0o755);
  try {
    try {
      renameSync(next, file);
    } catch (error) {
      if (process.platform !== "win32" || !existsSync(file)) throw error;
      setAside(file);
      renameSync(next, file);
    }
  } catch (error) {
    rmSync(next, { force: true });
    throw error;
  }
}

/**
 * Take a launcher off the path. `storytree setup remove` run through the launcher removes the very
 * program running it, which Windows will not delete while it runs: it is renamed off the path at
 * once, and deleted as soon as it exits (ADR-0854 D3).
 */
export function removeLauncher(file: string): void {
  sweep(file);
  try {
    rmSync(file, { force: true });
  } catch (error) {
    if (process.platform !== "win32") throw error;
    setAside(file);
  }
}

/** Put the command on the path. */
export function putCommandOnPath(where: CommandPath, node: string, target: string): CommandInstall {
  const launcher = launcherFor(node, target);
  const found = onPath(where).flatMap((folder) => launcherFiles().map((name) => path.join(folder, name))).filter((file) => existsSync(file));
  // Storytree's own launcher outside this home (another home's install) is not this user's to rewrite.
  const ours = found.filter((file) => isOurs(file) && inside(path.dirname(file), where.home));
  if (found.some((file) => !isOurs(file))) return "another storytree kept";
  if (ours.length > 0) {
    const [file] = ours;
    const wanted = path.join(path.dirname(file!), launcherFile());
    if (file === wanted && readFileSync(file).equals(launcher)) return "already installed";
    const before = launcherRuns(file!)?.target ?? "a build storytree cannot read";
    writeLauncher(wanted, launcher); // an older install's, pointing elsewhere, or the batch file it was
    if (file !== wanted) removeLauncher(file!);
    return `installed (replaced ${file!}, which ran ${before})`;
  }
  const folder = onPath(where).find((candidate) => inside(candidate, where.home) && writable(candidate));
  if (folder === undefined) return "no folder of the user's on the path";
  writeLauncher(path.join(folder, launcherFile()), launcher);
  return "installed";
}

/** Take storytree's `storytree` command off the path, leaving any other. */
export function removeCommand(where: CommandPath): "removed" | "none" {
  const ours = onPath(where)
    .flatMap((folder) => launcherFiles().map((name) => path.join(folder, name)))
    .filter((file) => existsSync(file) && isOurs(file) && inside(path.dirname(file), where.home));
  for (const file of ours) removeLauncher(file);
  return ours.length > 0 ? "removed" : "none";
}

/** Whether `gh` is installed and signed in, as `gh auth status` says. */
export async function ghState(options: MachineOptions = {}): Promise<GhState> {
  // `gh auth status` asks GitHub, which takes seconds (about ten on a Windows arm64 machine, 2026-09-28).
  const env = pathEnv(options.path);
  const waitMs = options.waitMs ?? 15_000;
  const version = await ask("gh", ["--version"], env, waitMs);
  if (!version.answered) return "not answering";
  if (version.code !== 0) return "missing";
  const status = await ask("gh", ["auth", "status"], env, waitMs);
  if (!status.answered) return "not answering";
  return status.code === 0 ? "signed in" : "signed out";
}

/** Rename a launcher off the path, and delete it once nothing runs it: a short-lived Node waits for that. */
function setAside(file: string): void {
  const aside = `${file}.${process.pid}-${Date.now()}.old`;
  renameSync(file, aside);
  spawn(process.execPath, ["-e", DELETE_ONCE_FREE, aside], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** Delete what an earlier set-aside left beside `file`, should its waiting Node not have outlived it. */
function sweep(file: string): void {
  const folder = path.dirname(file);
  const left = new RegExp(`^${path.basename(file).replace(/\./g, "\\.")}\\.\\d+-\\d+\\.old$`);
  try {
    for (const name of readdirSync(folder)) if (left.test(name)) rmSync(path.join(folder, name), { force: true });
  } catch {
    // Still running, or the folder cannot be read: the next write or removal tries again.
  }
}

/** Delete the file named after the script, retrying until it is free, for up to two minutes. */
const DELETE_ONCE_FREE = `const file = process.argv[1];
const until = Date.now() + 120000;
const attempt = () => { try { require("node:fs").rmSync(file, { force: true }); } catch { if (Date.now() < until) setTimeout(attempt, 200); } };
attempt();`;

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
