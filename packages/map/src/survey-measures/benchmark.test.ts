// Capability 10 · Survey run time and memory measured
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test, type TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import type { AnnotatedTree } from "@storytree/library";

import { surveyBenchmark, type SurveyBenchmark } from "./benchmark.js";

const tree = { arcs: [], stories: [
  { id: "story-shop", title: "Shop", capabilities: [{ id: "cap-shop", title: "1 · Value" }] },
  { id: "story-cart", title: "Cart", capabilities: [{ id: "cap-cart", title: "1 · Lines" }] },
  { id: "story-ghost", title: "Ghost", capabilities: [{ id: "cap-ghost", title: "1 · Nothing" }] },
] } as unknown as AnnotatedTree;

function repository(t: TestContext) {
  const folder = mkdtempSync(path.join(tmpdir(), "survey-benchmark-"));
  t.after(() => removeTemp(folder));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("-c", "user.name=Benchmark test", "-c", "user.email=benchmark@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  write("package.json", '{ "name": "fixture", "private": true }\n');
  write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
  for (const name of ["shop", "cart"]) {
    write(`packages/${name}/package.json`, `{ "name": "@fixture/${name}", "type": "module" }\n`);
    write(`packages/${name}/src/value.ts`, "export function value(x: number): number {\n  return x > 0 ? x : -x;\n}\n");
    write(`packages/${name}/src/value.test.ts`, 'import { value } from "./value.js";\ntest("1.1 a value", () => value(1));\n');
  }
  const both = commit("shop and cart");
  rmSync(path.join(folder, "packages/cart"), { recursive: true });
  const shopOnly = commit("cart gone");
  git("update-ref", "refs/remotes/origin/main", both);
  write("packages/shop/src/value.ts", "export const edited = 1;\n");
  write("packages/shop/src/staged.ts", "export const staged = 1;\n");
  git("add", "packages/shop/src/staged.ts");
  write("packages/shop/src/loose.ts", "export const loose = 1;\n");
  return { folder, git, both, shopOnly };
}

function state(repo: ReturnType<typeof repository>) {
  return {
    head: repo.git("rev-parse", "HEAD"),
    branch: repo.git("symbolic-ref", "HEAD"),
    refs: repo.git("for-each-ref", "--format=%(refname) %(objectname)"),
    index: repo.git("ls-files", "--stage"),
    status: repo.git("status", "--porcelain=v1", "--untracked-files=all", "--ignored"),
    worktrees: repo.git("worktree", "list", "--porcelain").replace(repo.folder, "<folder>"),
    stashes: repo.git("stash", "list"),
    files: ["value.ts", "staged.ts", "loose.ts"].map((file) => readFileSync(path.join(repo.folder, "packages/shop/src", file), "utf8")),
  };
}

function extractedLeft(folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(at, depth + 1);
      else if (at.split(path.sep).join("/").endsWith("packages/shop/src/value.ts")) found.push(at);
    }
  };
  walk(folder, 0);
  return found;
}

async function inPrivateTemp<T>(t: TestContext, run: (temp: string) => Promise<T>): Promise<T> {
  const temp = mkdtempSync(path.join(tmpdir(), "survey-benchmark-temp-"));
  t.after(() => removeTemp(temp));
  const kept = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TMPDIR = temp;
  process.env.TEMP = temp;
  process.env.TMP = temp;
  try {
    return await run(temp);
  } finally {
    for (const [name, value] of Object.entries(kept)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function assertShaped(reading: SurveyBenchmark, quantity: "wall" | "cpu" | "peak"): void {
  const { median, spread } = reading[quantity];
  assert.ok(typeof median === "number" && Number.isFinite(median) && median > 0, `${quantity}'s median is a positive finite number: ${median}`);
  assert.ok(typeof spread === "number" && Number.isFinite(spread) && spread >= 0, `${quantity}'s spread is a finite number not below zero: ${spread}`);
}

test("10.1 · surveyBenchmark surveys the commit given, extracted from the folder's Git objects rather than its working tree, the runs asked, answering the stories it read and each of wall, CPU and peak memory as a positive finite median and a non-negative spread, two runs' wall times fitting inside the whole call; it leaves the working tree, index, HEAD, refs and worktrees as they were and no extracted checkout behind, and refuses a commit the folder lacks naming it", async (t) => {
  const repo = repository(t);
  const before = state(repo);

  await inPrivateTemp(t, async (temp) => {
    const startedBoth = performance.now();
    const atBoth = await surveyBenchmark({ folder: repo.folder, commit: repo.both, tree, runs: 2 });
    const elapsedBoth = performance.now() - startedBoth;
    assert.deepEqual({ commit: atBoth.commit, runs: atBoth.runs, stories: atBoth.stories }, { commit: repo.both, runs: 2, stories: 2 }, "the older commit holds the shop and cart packages, though HEAD and the working tree hold only shop; the ghost story has none");
    for (const quantity of ["wall", "cpu", "peak"] as const) assertShaped(atBoth, quantity);
    assert.ok(atBoth.wall.median * 2 <= elapsedBoth, `two runs' wall times, which are twice their median, fit inside the whole call they ran in, whatever the machine's speed: ${atBoth.wall.median} * 2 against ${elapsedBoth}`);
    assert.deepEqual(state(repo), before, "the folder's working tree, index, HEAD, refs, worktrees and stashes are as they were");
    assert.deepEqual(extractedLeft(temp), [], "the extracted checkout is removed");

    const atShopOnly = await surveyBenchmark({ folder: repo.folder, commit: repo.shopOnly, tree, runs: 3 });
    assert.deepEqual({ commit: atShopOnly.commit, runs: atShopOnly.runs, stories: atShopOnly.stories }, { commit: repo.shopOnly, runs: 3, stories: 1 });
    for (const quantity of ["wall", "cpu", "peak"] as const) assertShaped(atShopOnly, quantity);
    assert.deepEqual(state(repo), before);
    assert.deepEqual(extractedLeft(temp), []);

    const missing = "deadbeef".repeat(5);
    await assert.rejects(
      surveyBenchmark({ folder: repo.folder, commit: missing, tree, runs: 2 }),
      (error: unknown) => error instanceof Error && error.message.includes(missing),
      "a commit the folder does not hold is refused, naming it",
    );
    assert.deepEqual(state(repo), before);
    assert.deepEqual(extractedLeft(temp), []);
  });
});

function gitOnlyPath(t: TestContext): string | undefined {
  const executable = process.platform === "win32" ? "git.exe" : "git";
  const tarName = process.platform === "win32" ? "tar.exe" : "tar";
  const git = (process.env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, executable)).find((file) => existsSync(file));
  if (git === undefined) return undefined;
  if (process.platform === "win32") return existsSync(path.join(path.dirname(git), tarName)) ? undefined : path.dirname(git);
  const bin = mkdtempSync(path.join(tmpdir(), "survey-benchmark-bin-"));
  t.after(() => removeTemp(bin));
  symlinkSync(git, path.join(bin, executable));
  return bin;
}

test("10.1 · surveyBenchmark refuses a commit it cannot extract because tar will not start, with tar's start error, leaving the folder as it was and no extracted checkout behind", async (t) => {
  const repo = repository(t);
  const before = state(repo);
  const bin = gitOnlyPath(t);
  if (bin === undefined) {
    t.skip("environment: no folder on PATH holds git without tar, so tar cannot be made to fail to start");
    return;
  }

  await inPrivateTemp(t, async (temp) => {
    const kept = process.env.PATH;
    process.env.PATH = bin;
    try {
      await assert.rejects(
        surveyBenchmark({ folder: repo.folder, commit: repo.both, tree, runs: 1 }),
        (error: unknown) => error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT" && (error as NodeJS.ErrnoException).syscall === "spawn tar",
        "tar failing to start rejects the benchmark with that start error",
      );
    } finally {
      process.env.PATH = kept;
    }
    assert.deepEqual(state(repo), before);
    assert.deepEqual(extractedLeft(temp), []);
  });
});
