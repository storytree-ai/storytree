import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Stable across NSIS updates: no versioned checkout, npm cache or portable extraction path. */
export function toolPaths(installDir: string, platform: NodeJS.Platform = process.platform): InstalledTools {
  const dir = path.join(path.resolve(installDir), "resources", "agent-tools");
  return {
    dir, app: path.join(path.resolve(installDir), platform === "win32" ? "storytree-0.3.exe" : "storytree-0.3"),
    node: path.join(dir, platform === "win32" ? "node.exe" : "node"),
    mcp: path.join(dir, scripts[0]!), hook: path.join(dir, scripts[1]!), setup: path.join(dir, scripts[2]!),
    cli: path.join(dir, scripts[3]!), deliver: path.join(dir, scripts[4]!),
  };
}

/** Package the whole buildBins output, including lazy imported chunks. */
export function writePayloadManifest(dir: string, arch: Architecture, nodeVersion: string): void {
  for (const file of ["node.exe", ...scripts]) {
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
  const payload = JSON.parse(readFileSync(path.join(tools.dir, "payload.json"), "utf8")) as {
    schema?: unknown; arch?: unknown; nodeVersion?: unknown; files?: Record<string, unknown>;
  };
  if (payload.schema !== 1 || typeof payload.nodeVersion !== "string" || !/^24\./.test(payload.nodeVersion) || !payload.files) throw new Error("Unsupported tool payload");
  if (payload.arch !== arch) throw new Error(`Tool runtime architecture ${String(payload.arch)} does not match ${arch}`);
  for (const file of [path.basename(tools.node), ...scripts]) {
    if (!(file in payload.files)) throw new Error(`Missing payload entry: ${file}`);
  }
  for (const [file, expected] of Object.entries(payload.files)) {
    if (!/^[\w@./-]+$/.test(file) || file.split("/").some((part) => part === ".." || part === "") || path.isAbsolute(file)) throw new Error(`Unsafe payload path: ${file}`);
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected) || digest(path.join(tools.dir, file)) !== expected) throw new Error(`Damaged payload file: ${file}`);
  }
  if (!existsSync(tools.app)) throw new Error(`Missing app executable: ${tools.app}`);
  return tools;
}
