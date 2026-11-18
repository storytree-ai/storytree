// Capability 1 · Get storytree
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Architecture = "x64" | "arm64";
export interface InstalledTools {
  readonly dir: string;
  readonly app: string;
  readonly node: string;
  readonly mcp: string;
  readonly hook: string;
  readonly setup: string;
  readonly cli: string;
  readonly deliver: string;
}

const scripts = ["storytree-mcp.mjs", "storytree-hook.mjs", "storytree-setup.mjs", "storytree.mjs", "storytree-deliver.mjs"];
const launcher = "storytree-launcher.exe";
const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

export function toolPaths(installDir: string, platform: NodeJS.Platform = process.platform): InstalledTools {
  const root = path.resolve(installDir);
  const contents = platform === "darwin" ? path.join(root, "Contents") : root;
  const dir = path.join(contents, platform === "darwin" ? "Resources" : "resources", "agent-tools");
  return toolsIn(dir, platform === "win32" ? path.join(root, "storytree-0.3.exe") : path.join(contents, platform === "darwin" ? "MacOS" : "", "storytree-0.3"), platform);
}

export function writePayloadManifest(dir: string, arch: Architecture, nodeVersion: string, platform: NodeJS.Platform = "win32"): void {
  for (const file of [...(platform === "win32" ? ["node.exe", launcher] : ["node"]), ...scripts]) {
    if (!existsSync(path.join(dir, file))) throw new Error(`Missing payload file: ${file}`);
  }
  const files: Record<string, string> = {};
  function visit(relative: string): void {
    for (const entry of readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name === "payload.json") continue;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files[name] = digest(path.join(dir, name));
      else throw new Error(`Unsupported payload file: ${name}`);
    }
  }
  visit("");
  writeFileSync(path.join(dir, "payload.json"), JSON.stringify({ schema: 1, arch, nodeVersion, files }, null, 2) + "\n");
}

export function verifyPayload(installDir: string, arch: Architecture, platform: NodeJS.Platform = process.platform): InstalledTools {
  const tools = toolPaths(installDir, platform);
  verifyTools(tools.dir, arch, platform);
  if (!existsSync(tools.app)) throw new Error(`Missing app executable: ${tools.app}`);
  return tools;
}

function verifyTools(dir: string, arch: Architecture, platform: NodeJS.Platform): void {
  const payload = JSON.parse(readFileSync(path.join(dir, "payload.json"), "utf8")) as {
    schema?: unknown; arch?: unknown; nodeVersion?: unknown; files?: Record<string, unknown>;
  };
  if (payload.schema !== 1 || typeof payload.nodeVersion !== "string" || !/^24\./.test(payload.nodeVersion) || !payload.files) throw new Error("Unsupported tool payload");
  if (payload.arch !== arch) throw new Error(`Tool runtime architecture ${String(payload.arch)} does not match ${arch}`);
  for (const file of [platform === "win32" ? "node.exe" : "node", ...(platform === "win32" ? [launcher] : []), ...scripts]) {
    if (!(file in payload.files)) throw new Error(`Missing payload entry: ${file}`);
  }
  for (const [file, expected] of Object.entries(payload.files)) {
    if (!/^[\w@./-]+$/.test(file) || file.split("/").some((part) => part === ".." || part === "") || path.isAbsolute(file)) throw new Error(`Unsafe payload path: ${file}`);
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected) || digest(path.join(dir, file)) !== expected) throw new Error(`Damaged payload file: ${file}`);
  }
}

function toolsIn(dir: string, app: string, platform: NodeJS.Platform): InstalledTools {
  return {
    dir, app, node: path.join(dir, platform === "win32" ? "node.exe" : "node"),
    mcp: path.join(dir, scripts[0]!), hook: path.join(dir, scripts[1]!), setup: path.join(dir, scripts[2]!),
    cli: path.join(dir, scripts[3]!), deliver: path.join(dir, scripts[4]!),
  };
}

export function stageTools(installDir: string, home: string, arch: Architecture, platform: NodeJS.Platform = process.platform): InstalledTools {
  const installed = verifyPayload(installDir, arch, platform);
  const build = createHash("sha256").update(readFileSync(path.join(installed.dir, "payload.json"))).digest("hex").slice(0, 16);
  const dir = path.join(home, "app-tools", build);
  const whole = (): boolean => {
    try { verifyTools(dir, arch, platform); return true; } catch { return false; }
  };
  if (!whole()) {
    const next = `${dir}.next-${process.pid}`;
    rmSync(next, { recursive: true, force: true });
    mkdirSync(path.dirname(dir), { recursive: true });
    cpSync(installed.dir, next, { recursive: true });
    if (existsSync(dir)) {
      const old = `${dir}.old-${process.pid}`;
      renameSync(dir, old);
      rmSync(old, { recursive: true, force: true });
    }
    try { renameSync(next, dir); } catch (error) {
      rmSync(next, { recursive: true, force: true });
      if (!whole()) throw error;
    }
    verifyTools(dir, arch, platform);
  }
  return toolsIn(dir, installed.app, platform);
}

export function clearOlderTools(home: string, keep: string, remove: (file: string) => void = (file) => rmSync(file, { force: true }), named: (name: string) => boolean = () => false, running: (dir: string) => boolean = () => false): void {
  const root = path.join(home, "app-tools");
  let names: string[];
  try { names = readdirSync(root); } catch { return; }
  for (const name of names) {
    const dir = path.join(root, name);
    if (dir === keep || /\.next-\d+$/.test(name) || named(name) || running(dir)) continue;
    try {
      for (const node of ["node.exe", "node"]) remove(path.join(dir, node));
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

export function runningFrom(
  // posix-only: its one caller, deliverTools (delivery.ts), calls it only when the platform is not win32.
  list: () => { status: number | null; stdout: unknown } = () => spawnSync("ps", ["-A", "-ww", "-o", "args="], { encoding: "utf8" }),
): (dir: string) => boolean {
  const listed = list();
  if (listed.status !== 0 || typeof listed.stdout !== "string") return () => true;
  const commands = listed.stdout;
  return (dir) => commands.includes(dir + path.posix.sep);
}

export function refreshTools(installDir: string, bundled: string): boolean {
  const { dir } = toolPaths(installDir, "linux");
  const manifest = (from: string): string | undefined => {
    try { return readFileSync(path.join(from, "payload.json"), "utf8"); } catch { return undefined; }
  };
  const wanted = manifest(bundled);
  if (wanted === undefined || wanted === manifest(dir)) return false;
  const next = `${dir}.next-${process.pid}`, old = `${dir}.old-${process.pid}`;
  rmSync(next, { recursive: true, force: true });
  cpSync(bundled, next, { recursive: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(next, dir);
  rmSync(old, { recursive: true, force: true });
  return true;
}
