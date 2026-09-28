/**
 * Capability 4 · Updates: the app follows merged main, contracts 4.1 and 4.2 in the app story
 * (ADR-0637 D2, the half for storytree 0.3's own development). Against real git: a throwaway
 * "origin" repository stands in for GitHub, and the build is a stand-in that records where it ran,
 * since a real one installs and bundles the whole app.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { setUpRuntime, updateToMain } from "./follow-main.js";

test("4.1 when merged main moves, the app is built at main's new commit beside the one running, and work not merged to main is never run", async () => {
  await withOrigin(async ({ origin, runtimeDir, commit }) => {
    const first = commit("main", "one");
    const built: string[] = [];
    const build = async (dir: string): Promise<void> => {
      built.push(`${path.basename(dir)} ${readFileSync(path.join(dir, "file.txt"), "utf8")}`);
    };

    const running = await setUpRuntime({ runtimeDir, origin, build });
    assert.deepEqual([running.slot, running.sha], ["a", first], "the first build is main's commit, in slot a");
    assert.equal(await updateToMain({ runtimeDir, running, build }), undefined, "while main has not moved, nothing is done");

    commit("feature", "unmerged");
    assert.equal(await updateToMain({ runtimeDir, running, build }), undefined, "a commit on another branch is never picked up");

    const second = commit("main", "two");
    const building: string[] = [];
    const next = await updateToMain({ runtimeDir, running, build, onBuilding: sha => building.push(sha) });
    assert.deepEqual(building, [second], "the new commit is reported while its build starts");
    assert.deepEqual([next?.slot, next?.sha], ["b", second], "when main moves, main's new commit is built in the other slot");
    assert.equal(readFileSync(path.join(running.dir, "file.txt"), "utf8"), "one", "and the running slot is left as it is");
    assert.deepEqual(built, ["a one", "b two"], "every build was of main");
  });
});

test("4.2 a build that fails leaves the running app as it is", async () => {
  await withOrigin(async ({ origin, runtimeDir, commit }) => {
    commit("main", "one");
    const running = await setUpRuntime({ runtimeDir, origin, build: async () => {} });
    commit("main", "two");
    await assert.rejects(
      updateToMain({ runtimeDir, running, build: async () => Promise.reject(new Error("the build broke")) }),
      /the build broke/,
      "the failure is reported",
    );
    assert.equal(readFileSync(path.join(running.dir, "file.txt"), "utf8"), "one", "and the running slot is untouched");
  });
});

// --- helpers ---------------------------------------------------------------------------------

interface Origin {
  origin: string;
  runtimeDir: string;
  /** Commit `text` as file.txt on `branch` of the origin, and return the commit's id. */
  commit: (branch: string, text: string) => string;
}

async function withOrigin(body: (origin: Origin) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "st-follow-main-"));
  const origin = path.join(root, "origin");
  const git = (...args: string[]): string => execFileSync("git", ["-C", origin, ...args], { encoding: "utf8" }).trim();
  try {
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    const commit = (branch: string, text: string): string => {
      git("checkout", "-q", "-B", branch, ...(branch === "main" || git("branch", "--list", branch) !== "" ? [] : ["main"]));
      writeFileSync(path.join(origin, "file.txt"), text);
      git("add", "file.txt");
      git("commit", "-q", "-m", text);
      const sha = git("rev-parse", "HEAD");
      git("checkout", "-q", "main");
      return sha;
    };
    await body({ origin, runtimeDir: path.join(root, "runtime"), commit });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
