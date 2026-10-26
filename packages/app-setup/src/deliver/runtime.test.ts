import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { linuxRuntime, macRuntime, NODE_VERSION, stageRuntime, windowsRuntime } from "./runtime.js";

test("1.1 / 1.4: runtime acquisition verifies bytes before replacing a payload", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree runtime "));
  const file = path.join(dir, "node.exe");
  const bytes = Buffer.from("verified executable");
  const runtime = { url: "https://example.invalid/node.exe", sha256: createHash("sha256").update(bytes).digest("hex") };
  try {
    writeFileSync(file, "last usable runtime");
    await assert.rejects(stageRuntime(file, runtime, async () => new Response("interrupted download")), /checksum/);
    assert.equal(readFileSync(file, "utf8"), "last usable runtime");
    await stageRuntime(file, runtime, async () => new Response(bytes));
    assert.deepEqual(readFileSync(file), bytes);
    let fetched = false;
    await stageRuntime(file, runtime, async () => { fetched = true; throw new Error("offline"); });
    assert.equal(fetched, false, "a verified staged runtime is reusable offline");
    assert.match(windowsRuntime("x64").url, /win-x64\/node.exe$/);
    assert.match(windowsRuntime("arm64").url, /win-arm64\/node.exe$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** A Node release archive as nodejs.org publishes it: `<root>/bin/node` inside a gzipped tar. */
function nodeArchive(dir: string, executable: Buffer): { bytes: Uint8Array<ArrayBuffer>; sha256: string } {
  const root = path.join(dir, "archive");
  mkdirSync(path.join(root, "node-fixture", "bin"), { recursive: true });
  writeFileSync(path.join(root, "node-fixture", "LICENSE"), "license");
  writeFileSync(path.join(root, "node-fixture", "bin", "node"), executable, { mode: 0o755 });
  const result = spawnSync("tar", ["-czf", "node.tar.gz", "node-fixture"], { cwd: root, env: { ...process.env, COPYFILE_DISABLE: "1" } });
  assert.equal(result.status, 0, String(result.stderr));
  const bytes = new Uint8Array(readFileSync(path.join(root, "node.tar.gz")));
  return { bytes, sha256: sha256(bytes) };
}
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

test("1.11: a Mac runtime is staged from Node's pinned darwin-arm64 archive, checksum-verified, extracted executable and reusable offline", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree mac runtime "));
  const file = path.join(dir, "agent-tools", "node");
  const executable = Buffer.from("#!/bin/sh\necho v24\n");
  const archive = nodeArchive(dir, executable);
  const runtime = { url: "https://example.invalid/node.tar.gz", sha256: archive.sha256, entry: "node-fixture/bin/node", executableSha256: sha256(executable) };
  try {
    const pinned = macRuntime("arm64");
    assert.equal(pinned.url, `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`);
    assert.equal(pinned.entry, `node-v${NODE_VERSION}-darwin-arm64/bin/node`);
    assert.match(pinned.sha256, /^[a-f0-9]{64}$/);
    assert.match(pinned.executableSha256, /^[a-f0-9]{64}$/);
    assert.throws(() => macRuntime("x64" as "arm64"), /Apple Silicon/);

    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "last usable runtime");
    await assert.rejects(stageRuntime(file, runtime, async () => new Response("interrupted download")), /checksum/);
    await assert.rejects(stageRuntime(file, { ...runtime, entry: "node-fixture/bin/missing" }, async () => new Response(archive.bytes)), /bin\/missing/);
    await assert.rejects(stageRuntime(file, { ...runtime, executableSha256: sha256(Buffer.from("another build")) }, async () => new Response(archive.bytes)), /checksum/);
    assert.equal(readFileSync(file, "utf8"), "last usable runtime");

    await stageRuntime(file, runtime, async () => new Response(archive.bytes));
    assert.deepEqual(readFileSync(file), executable);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o755, 0o755, "the staged runtime keeps its executable mode");
    let fetched = false;
    await stageRuntime(file, runtime, async () => { fetched = true; throw new Error("offline"); });
    assert.equal(fetched, false, "a verified staged runtime is reusable offline");
    assert.deepEqual(readdirSync(path.dirname(file)), ["node"], "nothing but the runtime is left in the payload folder");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("1.11: the pinned darwin-arm64 runtime runs on an Apple Silicon Mac", {
  skip: (process.platform !== "darwin" || process.arch !== "arm64") && "platform:darwin-arm64: only an Apple Silicon Mac can run Node's darwin-arm64 build",
  timeout: 240_000,
}, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree mac runtime "));
  const file = path.join(dir, "storytree.app", "Contents", "Resources", "agent-tools", "node");
  try {
    await stageRuntime(file, macRuntime("arm64"));
    const result = spawnSync(file, ["--version"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `v${NODE_VERSION}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("1.11: a Linux runtime is pinned to Node's linux-x64 archive and its executable; x64 only", () => {
  const pinned = linuxRuntime("x64");
  assert.equal(pinned.url, "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz");
  assert.equal(pinned.entry, "node-v24.22.1-linux-x64/bin/node");
  // Node's published SHASUMS256.txt for the archive; the archive's bin/node measured from it.
  assert.equal(pinned.sha256, "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c");
  assert.equal(pinned.executableSha256, "e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb");
  assert.throws(() => linuxRuntime("arm64" as "x64"), /x64/);
});

test("1.11: the pinned linux-x64 runtime runs on x64 Linux", {
  skip: (process.platform !== "linux" || process.arch !== "x64") && "platform:linux-x64: only x64 Linux can run Node's linux-x64 build",
  timeout: 240_000,
}, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree linux runtime "));
  const file = path.join(dir, "linux-unpacked", "resources", "agent-tools", "node");
  try {
    await stageRuntime(file, linuxRuntime("x64"));
    const result = spawnSync(file, ["--version"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `v${NODE_VERSION}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
