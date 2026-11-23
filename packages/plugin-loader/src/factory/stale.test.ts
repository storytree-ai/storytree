// Capability 5 · Factory plugins
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { factoryStale } from "./factory.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(cwd: string, file: string): void {
  writeFileSync(path.join(cwd, file), `${file}\n`);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", file);
}

function world(t: TestContext): { factory: string; pushFromElsewhere(count: number): void } {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-factory-stale-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const origin = path.join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", origin);
  const factory = path.join(dir, "factory");
  mkdirSync(factory);
  git(factory, "init", "-q", "-b", "main");
  commit(factory, "README.md");
  git(factory, "remote", "add", "origin", origin);
  git(factory, "push", "-q", "-u", "origin", "main");
  const elsewhere = path.join(dir, "elsewhere");
  git(dir, "clone", "-q", "--", origin, elsewhere);
  let made = 0;
  return {
    factory,
    pushFromElsewhere(count) {
      for (let one = 0; one < count; one++) commit(elsewhere, `later-${++made}.md`);
      git(elsewhere, "push", "-q", "origin", "HEAD:main");
    },
  };
}

test("5.25 · factoryStale fetches origin main and names the factory folder, how many commits HEAD is behind origin/main, how many paths git status lists, and STORYTREE_FACTORY=<worktree>, in one line", async (t) => {
  const { factory, pushFromElsewhere } = world(t);
  pushFromElsewhere(2);
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

test("5.25 · factoryStale counts from the origin/main it already knows when the fetch fails", async (t) => {
  const { factory, pushFromElsewhere } = world(t);
  pushFromElsewhere(2);
  git(factory, "fetch", "-q", "origin", "main");
  git(factory, "remote", "set-url", "origin", path.join(path.dirname(factory), "gone.git"));
  assert.match((await factoryStale(factory)) ?? "", /behind origin\/main by 2 commits/);
});

test("5.25 · factoryStale says so when only one of the two is not zero, behind with no changed paths or changed paths at origin/main, and says nothing for a clean clone at origin/main, a clean clone with commits origin/main lacks, or a folder that is not a git clone", async (t) => {
  const behind = world(t);
  behind.pushFromElsewhere(2);
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
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  mkdirSync(path.join(plain, "plugins"));
  assert.equal(await factoryStale(plain), undefined);
});
