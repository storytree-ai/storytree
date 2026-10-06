import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withSessionStore } from "./session-store.js";

const context = { clientId: "client_test", identityUrl: "https://identity.example.test/v1/identity" };

test("2.4 a private session survives reopening, is bound to its environment, and sign-out erases it", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-session-"));
  const directory = path.join(home, "identity");
  const use = <T>(act: Parameters<typeof withSessionStore<T>>[1]) => withSessionStore({ directory, ...context }, act);
  try {
    assert.equal(await use(store => store.read()), undefined);
    await use(store => store.write("refresh-private"));
    assert.equal(await use(store => store.read()), "refresh-private");
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { withSessionStore } from ${JSON.stringify(new URL("./session-store.ts", import.meta.url).href)};
       await withSessionStore(JSON.parse(process.argv[1]), async store => {
         if (await store.read() !== "refresh-private") process.exitCode = 1;
       });`, JSON.stringify({ directory, ...context })], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
    assert.equal(await withSessionStore({ directory, ...context, clientId: "client_other" }, store => store.read()), undefined);
    assert.deepEqual(await readdir(directory), ["session"]);
    if (process.platform === "win32") {
      assert.doesNotMatch(await readFile(path.join(directory, "session"), "utf8"), /refresh-private/);
    } else {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(path.join(directory, "session"))).mode & 0o777, 0o600);
    }
    await use(store => store.clear());
    assert.equal(await use(store => store.read()), undefined);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("2.4 session operations exclude competing commands and release their lock after a failed command", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-session-"));
  const config = { directory: path.join(home, "identity"), ...context };
  try {
    await withSessionStore(config, async store => {
      await store.write("refresh-private");
      await assert.rejects(withSessionStore(config, other => other.clear()), /already running/i);
      assert.equal(await store.read(), "refresh-private");
    });
    await assert.rejects(withSessionStore(config, async () => { throw new Error("command failed"); }), /command failed/);
    assert.equal(await withSessionStore(config, store => store.read()), "refresh-private");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("2.4 unsafe POSIX permissions or symlinks refuse token storage without following them", { skip: process.platform === "win32" }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-session-"));
  const directory = path.join(home, "identity");
  const config = { directory, ...context };
  try {
    await withSessionStore(config, store => store.write("refresh-private"));
    await chmod(directory, 0o755);
    await assert.rejects(withSessionStore(config, store => store.read()), /private session storage/i);
    await chmod(directory, 0o700);
    await chmod(path.join(directory, "session"), 0o644);
    await assert.rejects(withSessionStore(config, store => store.read()), /private session storage/i);
    await rm(path.join(directory, "session"));
    const other = path.join(home, "other");
    await symlink(other, path.join(directory, "session"));
    await assert.rejects(withSessionStore(config, store => store.read()), /private session storage/i);
  } finally { await rm(home, { recursive: true, force: true }); }
});
