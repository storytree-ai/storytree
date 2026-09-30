/**
 * Capability 4 · Sessions, contract 4.10: whether each branch a session worked on still holds open
 * work (ADR-0754 D4), found by asking GitHub (a stand-in here) and this machine's git, and written
 * to the real activity log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { openActivityLog, type Line } from "../activity/index.js";
import { git, withTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { lookAsApp, resolveBranches, sessionsFrom } from "./index.js";

test("4.10 each branch a session worked on is marked resolved once its pull request merged (any machine), or, on the machine it was worked on, once it has nothing ahead of main or is deleted; one still ahead stays open, and one that gains work after it resolved is open again; a state is written only when it changes", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      git(repo, "add", "a.txt");
      git(repo, "commit", "-q", "-m", "first");
      git(repo, "branch", "claude/not-ahead");
      git(repo, "switch", "-q", "-c", "claude/ahead");
      writeFileSync(path.join(repo, "b.txt"), "b\n");
      git(repo, "add", "b.txt");
      git(repo, "commit", "-q", "-m", "work");
      git(repo, "switch", "-q", "main");

      const here = { session: "worker", harness: "claude-code", source: "hook", machine: "here" } as const;
      const worked = (branch: string, folder = repo) => log.append(project, { ...here, folder, branch, kind: "file-edited", files: ["x.ts"] });
      await worked("claude/not-ahead");
      await worked("claude/ahead");
      await worked("claude/gone", path.join(repo, ".claude", "worktrees", "gone"));
      const elsewhere = { session: "laptop", harness: "claude-code", source: "hook", machine: "elsewhere", folder: "C:\\site" } as const;
      await log.append(project, { ...elsewhere, branch: "claude/merged", kind: "file-edited", files: ["y.ts"] });
      await log.append(project, { ...elsewhere, branch: "claude/laptop-only", kind: "file-edited", files: ["z.ts"] });

      const allMergedPulls = async () => new Map([["claude/merged", [{ number: 12, mergedAt: new Date(Date.now() + 1_000).toISOString() }]]]);
      const watcher = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { allMergedPulls, everyMs: 0, machine: "here" };
      const states = (lines: readonly Line[]) => lines.flatMap((line) => (line.kind === "branch-state" ? [[line.of, line.open, line.how, line.pr, line.session]] : [])).sort();

      assert.deepEqual(states(await resolveBranches(watcher, watch)), [
        ["claude/gone", false, "deleted", undefined, "observer"],
        ["claude/merged", false, "merged", 12, "observer"],
        ["claude/not-ahead", false, "not-ahead", undefined, "observer"],
      ]);
      assert.deepEqual(await resolveBranches(watcher, watch), [], "nothing changed, nothing written");

      git(repo, "switch", "-q", "claude/not-ahead");
      writeFileSync(path.join(repo, "c.txt"), "c\n");
      git(repo, "add", "c.txt");
      git(repo, "commit", "-q", "-m", "more");
      await worked("claude/not-ahead");
      assert.deepEqual(states(await resolveBranches(watcher, watch)), [["claude/not-ahead", true, "ahead", undefined, "observer"]]);
    });
  } finally {
    await log.close();
  }
});

test("4.10 a session whose branches merged, or exist nowhere this machine can see (not on origin, no branch here) and were worked on elsewhere, holds no open work after one look; one pushed to origin stays open; the machine that worked on it opens it again if it is still there", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const origin = path.join(dir, "origin.git");
      git(dir, "init", "-q", "--bare", "-b", "main", origin);
      const clone = (name: string) => {
        const repo = path.join(dir, name);
        git(dir, "clone", "-q", origin, repo);
        return repo;
      };
      const site = clone("site");
      writeFileSync(path.join(site, "a.txt"), "a\n");
      git(site, "add", "a.txt");
      git(site, "commit", "-q", "-m", "first");
      git(site, "push", "-q", "origin", "HEAD:main");
      git(site, "push", "-q", "origin", "HEAD:claude/pushed");
      const laptop = clone("laptop");
      git(laptop, "switch", "-q", "-c", "claude/never-pushed");
      writeFileSync(path.join(laptop, "b.txt"), "b\n");
      git(laptop, "add", "b.txt");
      git(laptop, "commit", "-q", "-m", "work");
      git(laptop, "switch", "-q", "main");

      const elsewhere = { harness: "claude-code", source: "hook", machine: "elsewhere", folder: laptop } as const;
      for (const branch of ["claude/merged", "claude/never-pushed"]) await log.append(project, { ...elsewhere, session: "finished", branch, kind: "file-edited", files: ["x.ts"] });
      await log.append(project, { ...elsewhere, machine: "third", session: "lane", branch: "claude/pushed", kind: "file-edited", files: ["y.ts"] });

      const allMergedPulls = async () => new Map([["claude/merged", [{ number: 12, mergedAt: new Date(Date.now() + 1_000).toISOString() }]]]);
      const watcher = (folder: string) => ({ log, project, folder, session: "observer", harness: "claude-code", source: "hook" }) as const;
      const openWork = async () => sessionsFrom((await log.since(project, 0)).lines).map((session) => [session.session, session.openWork]);

      await resolveBranches(watcher(site), { allMergedPulls, everyMs: 0, machine: "here" });
      assert.deepEqual(await openWork(), [["finished", []], ["lane", ["claude/pushed"]]]);

      await resolveBranches(watcher(laptop), { allMergedPulls, everyMs: 0, machine: "elsewhere" });
      assert.deepEqual(await openWork(), [["finished", ["claude/never-pushed"]], ["lane", ["claude/pushed"]]]);
      await resolveBranches(watcher(site), { allMergedPulls, everyMs: 0, machine: "here" });
      assert.deepEqual(await openWork(), [["finished", ["claude/never-pushed"]], ["lane", ["claude/pushed"]]], "a branch its own machine found is not guessed away again");
    });
  } finally {
    await log.close();
  }
});

test("4.10 a branch a claim's merge names holds no open work before any look has written its state; a later look that finds it ahead opens it again (regression: finished sessions counted as at work, 2026-09-30)", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    const at = { harness: "claude-code", machine: "laptop", folder: "C:\\site" } as const;
    await log.append(project, { ...at, source: "hook", session: "finished", branch: "claude/fix", kind: "file-edited", files: ["x.ts"] });
    await log.append(project, { ...at, source: "hook", session: "observer", kind: "merged", increment: "increment_1", holder: "finished", branch: "claude/fix", pr: 7 });
    const openWork = async () => Object.fromEntries(sessionsFrom((await log.since(project, 0)).lines).map((session) => [session.session, session.openWork]));
    assert.deepEqual((await openWork()).finished, [], "the merged line resolves the branch");

    await log.append(project, { ...at, source: "hook", session: "observer", kind: "branch-state", of: "claude/fix", open: true, how: "ahead" });
    assert.deepEqual((await openWork()).finished, ["claude/fix"], "a later look that found it ahead opens it again");
  } finally {
    await log.close();
  }
});

test("4.21 the app looks for itself: a branch a session on this machine worked on is resolved, asked from a folder this machine has, under the app's name, which lists as no session", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (site) => {
      const worked = await log.append(project, { session: "lane", harness: "claude-code", source: "hook", machine: "here", folder: site, branch: "claude/landed", kind: "file-edited", files: ["x.ts"] });
      const allMergedPulls = async () => new Map([["claude/landed", [{ number: 21, mergedAt: new Date(Date.parse(worked.at) + 1_000).toISOString() }]]]);

      const written = await lookAsApp(log, project, { allMergedPulls, everyMs: 0, machine: "here" });
      assert.deepEqual(written.map((line) => [line.kind, line.session]), [["branch-state", "app:here"]]);
      const sessions = sessionsFrom((await log.since(project, 0)).lines);
      assert.deepEqual(sessions.map((session) => [session.session, session.openWork]), [["lane", []]]);
    });
  } finally {
    await log.close();
  }
});
