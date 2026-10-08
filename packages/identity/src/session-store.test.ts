import assert from "node:assert/strict";
import childProcess, { spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { inspect } from "node:util";
import { withSessionStore } from "./session-store.js";

const context = { clientId: "client_test" };

function windowsChild(t: TestContext) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: t.mock.fn(() => { child.emit("close", null, "SIGTERM"); return true; }),
  });
  const ready = new Promise<void>(resolve => child.stdin.on("finish", resolve));
  let input = "";
  child.stdin.on("data", chunk => { input += chunk; });
  const spawn = t.mock.method(childProcess, "spawn", (_command: string, _args: readonly string[], options: SpawnOptionsWithoutStdio) => {
    // Reproduce the original spawn timeout as well as an explicit application timer.
    if (options?.timeout) {
      const timer = setTimeout(() => child.kill(), options.timeout);
      child.once("close", () => clearTimeout(timer));
    }
    return child as unknown as ChildProcessWithoutNullStreams;
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawn.mock.restore(); syncBuiltinESMExports();
    Object.defineProperty(process, "platform", platform);
  });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  return { child, ready, input: () => input };
}

test("2.4 Windows storage allows a cold protection process past ten seconds and writes only its ciphertext", async t => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-session-"));
  const { child, ready, input } = windowsChild(t);
  try {
    const writing = withSessionStore({ directory: home, ...context }, store => store.write("refresh-private"));
    await ready;
    t.mock.timers.tick(11_000);
    assert.equal(child.kill.mock.callCount(), 0);
    assert.match(input(), /refresh-private/);
    child.stdout.write("encrypted-session");
    child.emit("close", 0, null);
    await writing;
    assert.equal(await readFile(path.join(home, "session"), "utf8"), "encrypted-session");
    t.mock.timers.tick(60_000);
    assert.equal(child.kill.mock.callCount(), 0, "completion clears the deadline");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("2.4 Windows protection failures retain only safe diagnostics and leave the previous session untouched", async t => {
  for (const failure of ["timeout", "startup", "exit", "dpapi", "input", "output-limit", "empty-output"] as const) {
    await t.test(failure, async t => {
      const home = await mkdtemp(path.join(tmpdir(), "storytree-session-"));
      const { child, ready } = windowsChild(t);
      const config = { directory: home, ...context };
      try {
        await writeFile(path.join(home, "session"), "previous-ciphertext");
        const writing = withSessionStore(config, store => store.write("refresh-private"));
        const rejected = assert.rejects(writing, error => {
          const details = inspect(error);
          assert.match(details, /private session storage/i);
          assert.match(details, new RegExp(`Windows protection encrypt: ${failure}`));
          assert.match(details, /elapsedMs=\d+/);
          if (failure === "exit") assert.match(details, /exitCode=1/);
          if (failure === "startup") assert.match(details, /code=ENOENT/);
          assert.doesNotMatch(details, /refresh-private|private-stderr|private-error/);
          return true;
        });
        await ready;
        child.stderr.write("private-stderr refresh-private");
        if (failure === "timeout") t.mock.timers.tick(30_000);
        if (failure === "startup") child.emit("error", Object.assign(new Error("private-error refresh-private"), { code: "ENOENT" }));
        if (failure === "input") child.stdin.emit("error", new Error("private-error refresh-private"));
        if (failure === "output-limit") child.stdout.write("refresh-private".repeat(10_000));
        if (failure === "exit") child.emit("close", 1, null);
        if (failure === "dpapi") child.emit("close", 2, null);
        if (failure === "empty-output") child.emit("close", 0, null);
        await rejected;
        assert.equal(await readFile(path.join(home, "session"), "utf8"), "previous-ciphertext");
        assert.deepEqual(await readdir(home), ["session"]);
        if (failure === "timeout" || failure === "output-limit") assert.equal(child.kill.mock.callCount(), 1);
        await withSessionStore(config, store => store.clear());
      } finally { await rm(home, { recursive: true, force: true }); }
    });
  }
});

test("2.4 native Windows protection survives an eleven-second startup delay and still decrypts after reopening", { skip: process.platform !== "win32" }, async t => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-session-"));
  const spawn = childProcess.spawn;
  const delayed = t.mock.method(childProcess, "spawn", (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => {
    const delayedArgs = [...args];
    const script = Buffer.from(delayedArgs.at(-1)!, "base64").toString("utf16le");
    delayedArgs[delayedArgs.length - 1] = Buffer.from(`Start-Sleep -Seconds 11; ${script}`, "utf16le").toString("base64");
    return spawn(command, delayedArgs, options);
  });
  syncBuiltinESMExports();
  t.after(() => { delayed.mock.restore(); syncBuiltinESMExports(); });
  try {
    const config = { directory: home, ...context };
    await withSessionStore(config, store => store.write("refresh-private"));
    delayed.mock.restore(); syncBuiltinESMExports();
    assert.doesNotMatch(await readFile(path.join(home, "session"), "utf8"), /refresh-private/);
    assert.equal(await withSessionStore(config, store => store.read()), "refresh-private");
    await writeFile(path.join(home, "session"), "corrupt-private-session");
    await assert.rejects(withSessionStore(config, store => store.read()), error => {
      assert.match(inspect(error), /Windows protection decrypt: dpapi;.*exitCode=2/);
      assert.doesNotMatch(inspect(error), /corrupt-private-session/);
      return true;
    });
  } finally { await rm(home, { recursive: true, force: true }); }
});

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
