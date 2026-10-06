/**
 * Capability 1 · Postgres binaries. Where the Postgres tools (initdb, pg_ctl, postgres) come from: the @embedded-postgres package
 * built for this machine, which holds them in native/bin. There is no Windows arm64 build, so on
 * Windows arm64 the x64 one is used; Windows runs it under emulation. A packaged app ships the
 * binaries itself and hands over the directory it put them in.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface FindBinariesOptions {
  /** A directory that holds initdb, pg_ctl and postgres, as a packaged app ships them. It is checked, not searched. */
  readonly dir?: string;
  /** The machine to find binaries for. By default, this one. */
  readonly platform?: NodeJS.Platform | string;
  readonly arch?: string;
  /**
   * Where the @embedded-postgres packages are resolved from: a file, or a directory, inside a
   * project that depends on them. By default, this package.
   */
  readonly resolveFrom?: string;
}

/** The tools a data directory's server needs. */
const TOOLS = ["initdb", "pg_ctl", "postgres"] as const;

/** The @embedded-postgres packages to take the binaries from, in the order they are tried. */
export function binaryPackages(platform: NodeJS.Platform | string, arch: string): string[] {
  const os = platform === "win32" ? "windows" : platform;
  const packages = [`@embedded-postgres/${os}-${arch}`];
  // There is no Windows arm64 build; the x64 one runs under the OS's emulation.
  if (os === "windows" && arch === "arm64") packages.push("@embedded-postgres/windows-x64");
  return packages;
}

/**
 * The directory holding initdb, pg_ctl and postgres: `options.dir` if it holds them (anything else
 * is refused, naming it), or else the native/bin of the first of binaryPackages() that is
 * installed. Throws, naming every package it looked for, when none is.
 */
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

/** A path createRequire resolves from: a directory is taken as a file inside it. */
function anchor(resolveFrom: string | undefined): string {
  if (resolveFrom === undefined) return import.meta.url;
  return existsSync(resolveFrom) && statSync(resolveFrom).isDirectory() ? path.join(resolveFrom, "index.js") : resolveFrom;
}

function missingTools(dir: string, platform: NodeJS.Platform | string): string[] {
  return TOOLS.filter((tool) => !existsSync(path.join(dir, platform === "win32" ? `${tool}.exe` : tool)));
}

/** The root directory of package `name`, found by walking up from the file it resolved to. */
function packageRoot(entry: string, name: string): string {
  for (let dir = path.dirname(entry); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === name) return dir;
  }
  throw new Error(`cannot find the package root of ${name} (it resolved to ${entry})`);
}
