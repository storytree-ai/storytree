// Capability 5 · Factory plugins
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { quietFor, removeTemp, waitUntil } from "@storytree/test-waits";

import { factoryStale } from "./factory.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(cwd: string, file: string): void {
  writeFileSync(path.join(cwd, file), `${file}\n`);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", file);
}

const MINUTE = 60_000;

interface World {
  readonly factory: string;
  pushFromElsewhere(count: number): string;
  fetch(): void;
  lastFetchedAgo(ms: number): void;
  neverFetched(): void;
}

function world(t: TestContext): World {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-factory-stale-")));
  t.after(() => removeTemp(dir));
  const origin = path.join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", origin);
  const factory = path.join(dir, "factory");
  mkdirSync(factory);
  git(factory, "init", "-q", "-b", "main");
  commit(factory, "README.md");
  git(factory, "remote", "add", "origin", origin);
  git(factory, "push", "-q", "-u", "origin", "main");
  git(factory, "fetch", "-q", "origin", "main");
  const elsewhere = path.join(dir, "elsewhere");
  git(dir, "clone", "-q", "--", origin, elsewhere);
  const fetchHead = path.join(factory, ".git", "FETCH_HEAD");
  let made = 0;
  return {
    factory,
    pushFromElsewhere(count) {
      for (let one = 0; one < count; one++) commit(elsewhere, `later-${++made}.md`);
      git(elsewhere, "push", "-q", "origin", "HEAD:main");
      return git(elsewhere, "rev-parse", "HEAD");
    },
    fetch() {
      git(factory, "fetch", "-q", "origin", "main");
    },
    lastFetchedAgo(ms) {
      const then = new Date(Date.now() - ms);
      utimesSync(fetchHead, then, then);
    },
    neverFetched() {
      rmSync(fetchHead);
    },
  };
}

test("5.25 · factoryStale names the factory folder, how many commits HEAD is behind origin/main as last fetched, how many paths git status lists, and STORYTREE_FACTORY=<worktree>, in one line", async (t) => {
  const { factory, pushFromElsewhere, fetch } = world(t);
  pushFromElsewhere(2);
  fetch();
  writeFileSync(path.join(factory, "README.md"), "edited\n");
  writeFileSync(path.join(factory, "new-one.txt"), "new\n");
  writeFileSync(path.join(factory, "new-two.txt"), "new\n");
  const line = (await factoryStale(factory)) ?? "";
  assert.equal(line.trimEnd().split("\n").length, 1, `one line: ${line}`);
  assert.ok(line.includes(factory), `it names the folder ${factory}: ${line}`);
  assert.match(line, /behind origin\/main by 2 commits/);
  assert.match(line, /\b3 changed paths\b/);
  assert.match(line, /STORYTREE_FACTORY=/);
});

test("5.25 · factoryStale counts from the origin/main it already knows when the fetch it starts for a last fetch ten minutes old fails", async (t) => {
  const { factory, pushFromElsewhere, fetch, lastFetchedAgo } = world(t);
  pushFromElsewhere(2);
  fetch();
  git(factory, "remote", "set-url", "origin", path.join(path.dirname(factory), "gone.git"));
  lastFetchedAgo(10 * MINUTE);
  assert.match((await factoryStale(factory)) ?? "", /behind origin\/main by 2 commits/);
});

test("5.25 · factoryStale says so when only one of the two is not zero, behind with no changed paths or changed paths at origin/main, and says nothing for a clean clone at origin/main, a clean clone with commits origin/main lacks, or a folder that is not a git clone", async (t) => {
  const behind = world(t);
  behind.pushFromElsewhere(2);
  behind.fetch();
  assert.match((await factoryStale(behind.factory)) ?? "", /behind origin\/main by 2 commits/);
  const dirty = world(t);
  writeFileSync(path.join(dirty.factory, "README.md"), "edited\n");
  assert.match((await factoryStale(dirty.factory)) ?? "", /\b1 changed paths?\b/);
  const current = world(t);
  assert.equal(await factoryStale(current.factory), undefined);
  const ahead = world(t);
  commit(ahead.factory, "mine.md");
  assert.equal(await factoryStale(ahead.factory), undefined, "commits HEAD has that origin/main lacks are not behind");
  const plain = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-factory-plain-")));
  t.after(() => removeTemp(plain));
  mkdirSync(path.join(plain, "plugins"));
  assert.equal(await factoryStale(plain), undefined);
});

test("5.25 · factoryStale answers within 5 s, counting 2 behind from origin/main as last fetched, while the fetch it starts for a last fetch ten minutes old hangs on an origin that never replies", { timeout: 60_000 }, async (t) => {
  const { factory, pushFromElsewhere, fetch, lastFetchedAgo } = world(t);
  pushFromElsewhere(2);
  fetch();
  const held: Socket[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    held.push(socket);
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  try {
    const { port } = server.address() as { port: number };
    git(factory, "remote", "set-url", "origin", `git://127.0.0.1:${port}/origin.git`);
    lastFetchedAgo(10 * MINUTE);
    const started = performance.now();
    const line = (await factoryStale(factory)) ?? "";
    const took = performance.now() - started;
    assert.match(line, /behind origin\/main by 2 commits/);
    assert.ok(took < 5000, `it answered in ${Math.round(took)} ms, not waiting on the fetch`);
    await waitUntil(() => held.length > 0, 10_000, "the fetch factoryStale started to reach the origin");
  } finally {
    for (const socket of held) socket.destroy();
    await new Promise((closed) => server.close(closed));
  }
});

test("5.25 · the fetch factoryStale starts outlives a Ctrl-C to the command's process group, its connection to the origin still open after the command has gone", { timeout: 60_000, skip: process.platform === "win32" ? "platform: a process group signalled as one is POSIX's" : false }, async (t) => {
  const { factory, pushFromElsewhere, fetch, lastFetchedAgo } = world(t);
  pushFromElsewhere(2);
  fetch();
  const held: Socket[] = [];
  let closed = 0;
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.on("close", () => closed++);
    socket.resume();
    held.push(socket);
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  let group: number | undefined;
  try {
    const { port } = server.address() as { port: number };
    git(factory, "remote", "set-url", "origin", `git://127.0.0.1:${port}/origin.git`);
    lastFetchedAgo(10 * MINUTE);
    const command = `const { factoryStale } = await import(${JSON.stringify(new URL("./factory.ts", import.meta.url).href)}); process.stdout.write(((await factoryStale(${JSON.stringify(factory)})) ?? "nothing") + "\\n"); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", command], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    group = child.pid;
    let said = "";
    child.stdout.on("data", (chunk: Buffer) => (said += chunk.toString()));
    const gone = new Promise((exited) => child.on("exit", exited));
    await waitUntil(() => said.includes("\n"), 20_000, "the command's answer");
    assert.match(said, /behind origin\/main by 2 commits/);
    await waitUntil(() => held.length > 0, 10_000, "the fetch factoryStale started to reach the origin");
    process.kill(-group!, "SIGINT");
    await gone;
    group = undefined;
    await quietFor(() => closed > 0, 1000, "the fetch dying with the command's process group");
  } finally {
    if (group !== undefined) process.kill(-group, "SIGKILL");
    for (const socket of held) socket.destroy();
    await new Promise((done) => server.close(done));
  }
});

test("5.25 · with origin/main 2 commits ahead and a last fetch four minutes old, factoryStale counts from origin/main as last fetched, saying nothing, and starts no fetch", async (t) => {
  const { factory, pushFromElsewhere, lastFetchedAgo } = world(t);
  pushFromElsewhere(2);
  lastFetchedAgo(4 * MINUTE);
  const known = git(factory, "rev-parse", "origin/main");
  assert.equal(await factoryStale(factory), undefined);
  await quietFor(() => git(factory, "rev-parse", "origin/main") !== known, 1000, "a fetch moving origin/main");
});

test("5.25 · with origin/main 2 commits ahead and no last fetch, or one six minutes old, factoryStale says nothing on its first call and starts a fetch, from which a later call says 2 behind", async (t) => {
  const cases: [string, (one: World) => void][] = [
    ["never fetched", (one) => one.neverFetched()],
    ["fetched six minutes ago", (one) => one.lastFetchedAgo(6 * MINUTE)],
  ];
  for (const [what, age] of cases) {
    const one = world(t);
    const head = one.pushFromElsewhere(2);
    age(one);
    assert.equal(await factoryStale(one.factory), undefined, `${what}: the first call counts from origin/main as last fetched`);
    await waitUntil(() => git(one.factory, "rev-parse", "origin/main") === head, 10_000, `${what}: the fetch factoryStale started to land`);
    assert.match((await factoryStale(one.factory)) ?? "", /behind origin\/main by 2 commits/, what);
  }
});
