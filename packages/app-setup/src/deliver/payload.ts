/** Capability 1 · Get storytree. */
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
/** The program the `storytree` command on Windows is made from, beside the scripts (ADR-0854). */
const launcher = "storytree-launcher.exe";
const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * Stable across updates: no versioned checkout, npm cache or portable extraction path.
 * On macOS the installation is the .app bundle, whose resources and executable sit under Contents.
 */
export function toolPaths(installDir: string, platform: NodeJS.Platform = process.platform): InstalledTools {
  const root = path.resolve(installDir);
  const contents = platform === "darwin" ? path.join(root, "Contents") : root;
  const dir = path.join(contents, platform === "darwin" ? "Resources" : "resources", "agent-tools");
  return toolsIn(dir, platform === "win32" ? path.join(root, "storytree-0.3.exe") : path.join(contents, platform === "darwin" ? "MacOS" : "", "storytree-0.3"), platform);
}

/** Package the whole buildBins output, including lazy imported chunks: Windows needs its node.exe and command launcher, macOS its node. */
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

/** Refuse partial/mismatched payloads before changing the user's launchers or install record. */
export function verifyPayload(installDir: string, arch: Architecture, platform: NodeJS.Platform = process.platform): InstalledTools {
  const tools = toolPaths(installDir, platform);
  verifyTools(tools.dir, arch, platform);
  if (!existsSync(tools.app)) throw new Error(`Missing app executable: ${tools.app}`);
  return tools;
}

/** A folder of agent tools is whole: its payload.json names every entry point, and every file it lists has that file's digest. */
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

/** The tools of one folder of agent tools, with the app the installation runs. */
function toolsIn(dir: string, app: string, platform: NodeJS.Platform): InstalledTools {
  return {
    dir, app, node: path.join(dir, platform === "win32" ? "node.exe" : "node"),
    mcp: path.join(dir, scripts[0]!), hook: path.join(dir, scripts[1]!), setup: path.join(dir, scripts[2]!),
    cli: path.join(dir, scripts[3]!), deliver: path.join(dir, scripts[4]!),
  };
}

/**
 * On Windows the agents run storytree's tools from a copy under the home, never from the installation: a node.exe
 * running from the installation folder holds it, and the installer's check waits on it (contract 1.19). Each build's
 * copy has a folder of its own, named for its payload, so a session still running an older build's keeps it whole while
 * the next starts this one's. The installation's tools are verified, copied beside and renamed in, so no agent starts
 * from a half-copied folder; a copy already there and whole is reused.
 */
export function stageTools(installDir: string, home: string, arch: Architecture, platform: NodeJS.Platform = process.platform): InstalledTools {
  const installed = verifyPayload(installDir, arch, platform);
  const build = createHash("sha256").update(readFileSync(path.join(installed.dir, "payload.json"))).digest("hex").slice(0, 16);
  // Not the home's agent-tools, which keeps a checkout's own builds of main and prunes them (Built commands).
  const dir = path.join(home, "app-tools", build);
  const whole = (): boolean => {
    try { verifyTools(dir, arch, platform); return true; } catch { return false; }
  };
  if (!whole()) {
    const next = `${dir}.next-${process.pid}`;
    rmSync(next, { recursive: true, force: true });
    mkdirSync(path.dirname(dir), { recursive: true });
    cpSync(installed.dir, next, { recursive: true });
    // A damaged copy is moved aside (one still in use cannot be, and the start says so); one another start renamed in meanwhile is kept.
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

/**
 * Every copy under the home's app-tools but `keep` goes once no process runs it (contract 1.21). Its node goes first:
 * Windows refuses to delete a node.exe a session or hook still runs, though it lets the folder holding it be moved, so
 * a copy whose node stays keeps every file and is tried again at the next start, and one whose node went can start
 * nothing more. Another start's copy still being made (`.next-`) is left alone.
 */
export function clearOlderTools(home: string, keep: string, remove: (file: string) => void = (file) => rmSync(file, { force: true })): void {
  const root = path.join(home, "app-tools");
  let names: string[];
  try { names = readdirSync(root); } catch { return; }
  for (const name of names) {
    const dir = path.join(root, name);
    if (dir === keep || /\.next-\d+$/.test(name)) continue;
    try {
      for (const node of ["node.exe", "node"]) remove(path.join(dir, node));
      rmSync(dir, { recursive: true, force: true });
    } catch { /* In use: the next start tries again. */ }
  }
}

/**
 * On Linux the agent tools sit beside the AppImage, extracted by the one-liner: the hooks and MCP server need a
 * Node whose path stays put, and a running AppImage's mount moves. An AppImage that replaced itself still has the
 * old build's tools there, so its next start copies its own (`bundled`, its resources/agent-tools) over them,
 * keeping their paths (contract 1.5). True when it replaced them; tools that already match are left alone.
 */
export function refreshTools(installDir: string, bundled: string): boolean {
  const { dir } = toolPaths(installDir, "linux");
  const manifest = (from: string): string | undefined => {
    try { return readFileSync(path.join(from, "payload.json"), "utf8"); } catch { return undefined; }
  };
  const wanted = manifest(bundled);
  if (wanted === undefined || wanted === manifest(dir)) return false;
  // Copied beside, then swapped in: a hook never starts from a half-copied folder, nor one mixing two builds.
  const next = `${dir}.next-${process.pid}`, old = `${dir}.old-${process.pid}`;
  rmSync(next, { recursive: true, force: true });
  cpSync(bundled, next, { recursive: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(next, dir);
  rmSync(old, { recursive: true, force: true });
  return true;
}
