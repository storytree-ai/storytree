/** Capability 1 · Get storytree. */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Architecture } from "./payload.js";

/** A pinned Node runtime: the downloaded file's hash, and for an archive the entry to extract and that executable's hash. */
export interface Runtime {
  readonly url: string;
  readonly sha256: string;
  readonly entry?: string;
  readonly executableSha256?: string;
}

// Pinned release + hashes from https://nodejs.org/dist/v24.22.1/SHASUMS256.txt.
// The runtime travels with the app release; the bootstrap never installs a global Node.
export const NODE_VERSION = "24.22.1";
const hashes: Record<Architecture, string> = {
  x64: "d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5",
  arm64: "8bea91dc437fe01e7d92ef0efc6c9eaf654369aaba9b2d3e9841552ea7b95a00",
};
export function windowsRuntime(arch: Architecture): Runtime {
  return { url: `https://nodejs.org/dist/v${NODE_VERSION}/win-${arch}/node.exe`, sha256: hashes[arch] };
}

/** Apple Silicon only (decision_dfb6e40aa9f7). The executable's hash was measured from the pinned archive's bin/node. */
export function macRuntime(arch: Architecture): Runtime & { entry: string; executableSha256: string } {
  if (arch !== "arm64") throw new Error("storytree on macOS supports Apple Silicon (arm64) only");
  const name = `node-v${NODE_VERSION}-darwin-arm64`;
  return {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/${name}.tar.gz`,
    sha256: "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7",
    entry: `${name}/bin/node`,
    executableSha256: "6f32069480ec14d52b6d7b1f3c7124cfbbc46203abf5ddf5c65b127435f3f329",
  };
}

/** x64 Linux only (arc_38613dac8d7c). The executable's hash was measured from the pinned archive's bin/node. */
export function linuxRuntime(arch: Architecture): Runtime & { entry: string; executableSha256: string } {
  if (arch !== "x64") throw new Error("storytree on Linux supports x64 only");
  const name = `node-v${NODE_VERSION}-linux-x64`;
  return {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/${name}.tar.gz`,
    sha256: "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c",
    entry: `${name}/bin/node`,
    executableSha256: "e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb",
  };
}

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function stageRuntime(file: string, runtime: Runtime, download: typeof fetch = fetch): Promise<void> {
  const expected = runtime.entry === undefined ? runtime.sha256 : runtime.executableSha256;
  if (expected === undefined) throw new Error("An archived Node runtime needs its executable's pinned hash");
  if (existsSync(file) && hash(readFileSync(file)) === expected) return;
  const response = await download(runtime.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Node runtime download failed: HTTP ${response.status}`);
  const downloaded = new Uint8Array(await response.arrayBuffer());
  if (hash(downloaded) !== runtime.sha256) throw new Error("Node runtime checksum mismatch; the previous payload was kept");
  const bytes = runtime.entry === undefined ? downloaded : tarEntry(gunzipSync(downloaded), runtime.entry);
  if (hash(bytes) !== expected) throw new Error("Node runtime executable checksum mismatch; the previous payload was kept");
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.download`;
  try {
    writeFileSync(temp, bytes);
    chmodSync(temp, 0o755);
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}

/** One regular file's bytes from a ustar/pax/GNU tar, as Node's release archives are. */
function tarEntry(tar: Buffer, wanted: string): Buffer {
  const text = (start: number, length: number) => tar.toString("utf8", start, start + length).replace(/\0.*$/s, "");
  let longName: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    if (tar.subarray(offset, offset + 512).every((byte) => byte === 0)) break;
    const size = parseInt(text(offset + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[offset + 156] ?? 0);
    const prefix = text(offset + 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100));
    const body = tar.subarray(offset + 512, offset + 512 + size);
    longName = undefined;
    if (type === "x") longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1];
    else if (type === "L") longName = body.toString("utf8").replace(/\0.*$/s, "");
    else if ((type === "0" || type === "\0") && name.replace(/^\.\//, "") === wanted) return Buffer.from(body);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Node runtime archive has no ${wanted}`);
}
