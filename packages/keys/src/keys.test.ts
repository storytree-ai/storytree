/** Keys 1.1–1.4: the owner-only file, its lock, the resolution order and `!command` entries (ADR-0843). */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { authFile, removeKey, resolveKey, saveKey } from "./index.js";
import { withLock } from "./keys.js";

function scratch(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-keys-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "home");
}

test("keys 1.1: saving creates auth.json in storytree's home, readable and writable by the user alone", (t) => {
  const home = scratch(t);
  saveKey("anthropic", "sk-one", { home });
  const file = path.join(home, "auth.json");
  assert.equal(authFile({ home }), file);
  assert.equal(resolveKey("anthropic", { home, env: {} }), "sk-one");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);

  const moved = scratch(t);
  const before = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = moved;
  try {
    saveKey("github", "gh-two");
    assert.equal(authFile(), path.join(moved, "auth.json"));
    assert.equal(resolveKey("github", { env: {} }), "gh-two");
  } finally {
    if (before === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = before;
  }

  assert.equal(removeKey("anthropic", { home }), true);
  assert.equal(removeKey("anthropic", { home }), false);
  assert.equal(resolveKey("anthropic", { home, env: {} }), undefined);
});

test("keys 1.2: two writers at once lose nothing", async (t) => {
  const home = scratch(t);
  const writer = fileURLToPath(new URL("./testing-writer.ts", import.meta.url));
  const tsx = import.meta.resolve("tsx");
  const count = 15;
  const run = (prefix: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsx, writer, home, prefix, String(count)], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`writer ${prefix} exited ${code}: ${stderr}`))));
  });
  await Promise.all(["a", "b", "c", "d"].map(run));
  const saved = JSON.parse(readFileSync(authFile({ home }), "utf8")) as Record<string, unknown>;
  assert.equal(Object.keys(saved).length, 4 * count);
  for (const prefix of ["a", "b", "c", "d"]) {
    for (let i = 0; i < count; i++) assert.equal(resolveKey(`${prefix}-${i}`, { home, env: {} }), `value-${prefix}-${i}`);
  }
});

test("keys 1.2: a writer refused the lock by Windows's EPERM, as when the lock is being removed, waits and takes it", (t) => {
  const lock = path.join(path.dirname(scratch(t)), "auth.json.lock");
  let opens = 0;
  const open = (file: string) => {
    if (opens++ === 0) throw Object.assign(new Error(`EPERM: operation not permitted, open '${file}'`), { code: "EPERM" });
    closeSync(openSync(file, "wx"));
  };
  let wrote = false;
  withLock(lock, () => (wrote = true), { open });
  assert.equal(wrote, true);
});

test("keys 1.2: a lock that is always refused with EPERM fails at the deadline, not forever", (t) => {
  const lock = path.join(path.dirname(scratch(t)), "auth.json.lock");
  const open = (file: string) => {
    throw Object.assign(new Error(`EPERM: operation not permitted, open '${file}'`), { code: "EPERM" });
  };
  assert.throws(() => withLock(lock, () => {}, { open, waitMs: 50 }), /locked by another storytree process/);
});

test("keys 1.3: an explicit value beats the saved entry, which beats the environment variable", (t) => {
  const home = scratch(t);
  const env = { ANTHROPIC_API_KEY: "from-env", MY_TOKEN: "token-env" };
  assert.equal(resolveKey("anthropic", { home, env }), "from-env");
  assert.equal(resolveKey("my-token", { home, env }), "token-env");
  assert.equal(resolveKey("anthropic", { home, env, variable: "OTHER" }), undefined);
  saveKey("anthropic", "from-file", { home });
  assert.equal(resolveKey("anthropic", { home, env }), "from-file");
  assert.equal(resolveKey("anthropic", { home, env, explicit: "given" }), "given");
});

test("keys 1.4: a !command entry runs once per process, and a failing one names the key, not its output", (t) => {
  const home = scratch(t);
  const counter = path.join(path.dirname(home), "ran.txt").replaceAll("\\", "/");
  const node = `"${process.execPath}"`;
  saveKey("vault", `!${node} -e "require('fs').appendFileSync('${counter}','x');process.stdout.write('  from-command\\n')"`, { home });
  assert.equal(resolveKey("vault", { home, env: {} }), "from-command");
  assert.equal(resolveKey("vault", { home, env: {} }), "from-command");
  assert.equal(readFileSync(counter, "utf8"), "x");

  saveKey("broken", `!${node} -e "process.stdout.write('leaked-secret');process.stderr.write('leaked-error');process.exit(3)"`, { home });
  assert.throws(() => resolveKey("broken", { home, env: {} }), (error: Error) => {
    assert.match(error.message, /broken/);
    assert.doesNotMatch(error.message, /leaked/);
    return true;
  });
});
