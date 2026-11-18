// Capability 1 · Postgres binaries
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface FindBinariesOptions {
  readonly dir?: string;
  readonly platform?: NodeJS.Platform | string;
  readonly arch?: string;
  readonly resolveFrom?: string;
}

const TOOLS = ["initdb", "pg_ctl", "postgres"] as const;

export function binaryPackages(platform: NodeJS.Platform | string, arch: string): string[] {
  const os = platform === "win32" ? "windows" : platform;
  const packages = [`@embedded-postgres/${os}-${arch}`];
  if (os === "windows" && arch === "arm64") packages.push("@embedded-postgres/windows-x64");
  return packages;
}

export function findBinaries(options: FindBinariesOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (options.dir !== undefined) {
    const missing = missingTools(options.dir, platform);
    if (missing.length > 0) {
      throw new Error(`${options.dir} does not hold the Postgres tools (no ${missing.join(", ")} there)`);
    }
    return options.dir;
  }
  const arch = options.arch ?? process.arch;
  const candidates = binaryPackages(platform, arch);
  const require = createRequire(anchor(options.resolveFrom));
  for (const name of candidates) {
    let entry: string;
    try {
      entry = require.resolve(name);
    } catch {
      continue;
    }
    const bin = path.join(packageRoot(entry, name), "native", "bin");
    if (missingTools(bin, platform).length === 0) return bin;
  }
  throw new Error(
    `no Postgres binaries for ${platform}-${arch} (looked for ${candidates.join(", ")}): run \`pnpm install\``,
  );
}

function anchor(resolveFrom: string | undefined): string {
  if (resolveFrom === undefined) return import.meta.url;
  return existsSync(resolveFrom) && statSync(resolveFrom).isDirectory() ? path.join(resolveFrom, "index.js") : resolveFrom;
}

function missingTools(dir: string, platform: NodeJS.Platform | string): string[] {
  return TOOLS.filter((tool) => !existsSync(path.join(dir, platform === "win32" ? `${tool}.exe` : tool)));
}

function packageRoot(entry: string, name: string): string {
  for (let dir = path.dirname(entry); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === name) return dir;
  }
  throw new Error(`cannot find the package root of ${name} (it resolved to ${entry})`);
}
