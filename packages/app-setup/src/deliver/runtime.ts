/** Capability 1 · Get storytree. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Architecture } from "./payload.js";

// Pinned release + hashes from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.
// The runtime travels with the app release; the bootstrap never installs a global Node.
export const NODE_VERSION = "24.21.0";
const hashes: Record<Architecture, string> = {
  x64: "ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32",
  arm64: "dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7",
};
export function windowsRuntime(arch: Architecture) {
  return { url: `https://nodejs.org/dist/v${NODE_VERSION}/win-${arch}/node.exe`, sha256: hashes[arch] };
}

export async function stageRuntime(file: string, runtime: { url: string; sha256: string }, download: typeof fetch = fetch): Promise<void> {
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  if (existsSync(file) && hash(readFileSync(file)) === runtime.sha256) return;
  const response = await download(runtime.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Node runtime download failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (hash(bytes) !== runtime.sha256) throw new Error("Node runtime checksum mismatch; the previous payload was kept");
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.download`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}
