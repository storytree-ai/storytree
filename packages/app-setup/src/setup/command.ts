// Capability 18 · Built commands.
import { spawn } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface CommandPath {
  readonly path: string;
  readonly home: string;
}

export type CommandInstall =
  | "installed"
  | "would install"
  | `would replace ${string}, which runs ${string}`
  | `installed (replaced ${string}, which ran ${string})`
  | "already installed"
  | "another storytree kept"
  | "no folder of the user's on the path";

export interface LauncherRuns {
  readonly node: string;
  readonly target: string;
}

const MARKER = "storytree 0.3's command (put here by its setup check)";
const PROGRAM = "storytree-launcher.exe";
const TRAILER = "stlr";

export function launcherFile(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "storytree.exe" : "storytree";
}

export function launcherFiles(platform: NodeJS.Platform = process.platform): string[] {
  return platform === "win32" ? ["storytree.exe", "storytree.cmd"] : ["storytree"];
}

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
  const script = /exec "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)" "\$@"/.exec(text);
  if (script !== null) return { node: script[1]!.replace(/\\(.)/g, "$1"), target: script[2]!.replace(/\\(.)/g, "$1") };
  const batch = /"([^"]*)" "([^"]*)" %\*/.exec(text);
  return batch === null ? undefined : { node: batch[1]!.replaceAll("%%", "%"), target: batch[2]!.replaceAll("%%", "%") };
}

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

export function removeLauncher(file: string): void {
  sweep(file);
  try {
    rmSync(file, { force: true });
  } catch (error) {
    if (process.platform !== "win32") throw error;
    setAside(file);
  }
}

export function putCommandOnPath(where: CommandPath, node: string, target: string, look = false): CommandInstall {
  const launcher = launcherFor(node, target);
  const found = onPath(where).flatMap((folder) => launcherFiles().map((name) => path.join(folder, name))).filter((file) => existsSync(file));
  const ours = found.filter((file) => isOurs(file) && inside(path.dirname(file), where.home));
  if (found.some((file) => !isOurs(file))) return "another storytree kept";
  if (ours.length > 0) {
    const [file] = ours;
    const wanted = path.join(path.dirname(file!), launcherFile());
    if (file === wanted && readFileSync(file).equals(launcher)) return "already installed";
    const before = launcherRuns(file!)?.target ?? "a build storytree cannot read";
    if (look) return `would replace ${file!}, which runs ${before}`;
    writeLauncher(wanted, launcher);
    if (file !== wanted) removeLauncher(file!);
    return `installed (replaced ${file!}, which ran ${before})`;
  }
  const folder = onPath(where).find((candidate) => inside(candidate, where.home) && writable(candidate));
  if (folder === undefined) return "no folder of the user's on the path";
  if (look) return "would install";
  writeLauncher(path.join(folder, launcherFile()), launcher);
  return "installed";
}

export function removeCommand(where: CommandPath): "removed" | "none" {
  const ours = onPath(where)
    .flatMap((folder) => launcherFiles().map((name) => path.join(folder, name)))
    .filter((file) => existsSync(file) && isOurs(file) && inside(path.dirname(file), where.home));
  for (const file of ours) removeLauncher(file);
  return ours.length > 0 ? "removed" : "none";
}

function setAside(file: string): void {
  const aside = `${file}.${process.pid}-${Date.now()}.old`;
  renameSync(file, aside);
  spawn(process.execPath, ["-e", DELETE_ONCE_FREE, aside], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

function sweep(file: string): void {
  const folder = path.dirname(file);
  const prefix = `${path.basename(file)}.`;
  const left = (name: string) => name.startsWith(prefix) && /^\d+-\d+\.old$/.test(name.slice(prefix.length));
  try {
    for (const name of readdirSync(folder)) if (left(name)) rmSync(path.join(folder, name), { force: true });
  } catch {
  }
}

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
