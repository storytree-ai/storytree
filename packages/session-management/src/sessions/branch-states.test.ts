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
import { gitRunner, type GitRunner } from "./branch-states.js";
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
      const allOpenPulls = async () => new Map<string, never>();
      const watcher = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { allMergedPulls, allOpenPulls, everyMs: 0, budgetMs: 60_000, machine: "here" };
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
      const allOpenPulls = async () => new Map<string, never>();
      const watcher = (folder: string) => ({ log, project, folder, session: "observer", harness: "claude-code", source: "hook" }) as const;
      const openWork = async () => sessionsFrom((await log.since(project, 0)).lines).map((session) => [session.session, session.openWork]);

      await resolveBranches(watcher(site), { allMergedPulls, allOpenPulls, everyMs: 0, budgetMs: 60_000, machine: "here" });
      assert.deepEqual(await openWork(), [["finished", []], ["lane", ["claude/pushed"]]]);

      await resolveBranches(watcher(laptop), { allMergedPulls, allOpenPulls, everyMs: 0, budgetMs: 60_000, machine: "elsewhere" });
      assert.deepEqual(await openWork(), [["finished", ["claude/never-pushed"]], ["lane", ["claude/pushed"]]]);
      await resolveBranches(watcher(site), { allMergedPulls, allOpenPulls, everyMs: 0, budgetMs: 60_000, machine: "here" });
      assert.deepEqual(await openWork(), [["finished", ["claude/never-pushed"]], ["lane", ["claude/pushed"]]], "a branch its own machine found is not guessed away again");
    });
  } finally {
    await log.close();
  }
});

test("4.10 a git that does not answer whether a branch exists leaves it unresolved, never deleted; once git answers, the next look resolves it", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      git(repo, "add", "a.txt");
      git(repo, "commit", "-q", "-m", "first");
      await log.append(project, { session: "worker", harness: "claude-code", source: "hook", machine: "here", folder: repo, branch: "claude/gone", kind: "file-edited", files: ["x.ts"] });

      const watcher = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { allMergedPulls: async () => new Map(), allOpenPulls: async () => new Map(), everyMs: 0, budgetMs: 60_000, machine: "here" };
      // A loaded machine: git answers everything but one question, which outlasts its wait.
      const slow = (question: string): GitRunner => async (cwd, timeout, args) => (args.includes(question) ? { answered: false } : gitRunner(cwd, timeout, args));
      for (const question of ["--verify", "symbolic-ref"]) assert.deepEqual(await resolveBranches(watcher, { ...watch, git: slow(question) }), [], `a slow ${question} is not absence`);

      const found = await resolveBranches(watcher, watch);
      assert.deepEqual(found.flatMap((line) => (line.kind === "branch-state" ? [[line.of, line.open, line.how]] : [])), [["claude/gone", false, "deleted"]]);
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

test("4.24 the same look reads each open branch's pull request from GitHub in one call: its number, whether it is a draft, its checks (pending, passing or failing) and whether it waits in the merge queue; a change is written, nothing else is; GitHub not answering erases nothing; the Session reading carries it on each open branch", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      git(repo, "add", "a.txt");
      git(repo, "commit", "-q", "-m", "first");
      git(repo, "switch", "-q", "-c", "claude/ahead");
      writeFileSync(path.join(repo, "b.txt"), "b\n");
      git(repo, "add", "b.txt");
      git(repo, "commit", "-q", "-m", "work");
      git(repo, "switch", "-q", "main");

      await log.append(project, { session: "worker", harness: "claude-code", source: "hook", machine: "here", folder: repo, branch: "claude/ahead", kind: "file-edited", files: ["x.ts"] });
      await log.append(project, { session: "laptop", harness: "claude-code", source: "hook", machine: "elsewhere", folder: "C:\site", branch: "claude/laptop", kind: "file-edited", files: ["y.ts"] });

      type Pulls = Map<string, { number: number; draft: boolean; checks?: "pending" | "passing" | "failing"; queued: boolean }>;
      let answer: Pulls | undefined = new Map([
        ["claude/ahead", { number: 40, draft: false, checks: "pending", queued: false }],
        ["claude/laptop", { number: 41, draft: true, queued: false }],
      ]);
      const watcher = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { allMergedPulls: async () => new Map(), allOpenPulls: async () => answer, everyMs: 0, machine: "here" };
      const pulls = (lines: readonly Line[]) => lines.flatMap((line) => (line.kind === "branch-state" ? [[line.of, line.open, line.pr, line.draft, line.checks, line.queued]] : [])).sort();

      assert.deepEqual(pulls(await resolveBranches(watcher, watch)), [
        ["claude/ahead", true, 40, undefined, "pending", undefined],
        ["claude/laptop", true, 41, true, undefined, undefined],
      ]);
      assert.deepEqual(await resolveBranches(watcher, watch), [], "nothing changed, nothing written");

      answer = new Map([["claude/ahead", { number: 40, draft: false, checks: "passing", queued: true }], ["claude/laptop", { number: 41, draft: true, queued: false }]]);
      assert.deepEqual(pulls(await resolveBranches(watcher, watch)), [["claude/ahead", true, 40, undefined, "passing", true]]);

      answer = undefined;
      assert.deepEqual(await resolveBranches(watcher, { ...watch, allOpenPulls: async () => { throw new Error("gh is signed out"); } }), [], "GitHub not answering learns nothing");
      assert.deepEqual(await resolveBranches(watcher, watch), [], "nor does an answer that says nothing");

      const [worker] = sessionsFrom((await log.since(project, 0)).lines).filter((session) => session.session === "worker");
      assert.deepEqual(worker?.branchesByFolder, [{ folder: repo, branch: "claude/ahead", open: true, pr: { number: 40, draft: false, checks: "passing", queued: true } }]);

      answer = new Map([["claude/laptop", { number: 41, draft: true, queued: false }]]);
      assert.deepEqual(pulls(await resolveBranches(watcher, watch)), [["claude/ahead", true, undefined, undefined, undefined, undefined]], "a pull request closed unmerged leaves the branch open, with none");
    });
  } finally {
    await log.close();
  }
});

test("4.21 the look never stalls its process: while git takes its time asking origin, a timer due meanwhile still fires promptly (ADR-0836 D3: the app's minute look runs on its main process)", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      // Origin answers slowly: the stand-in for a network round trip is an ssh command that waits 1.5 s.
      git(repo, "remote", "add", "origin", "ssh://origin.invalid/site.git");
      git(repo, "config", "core.sshCommand", `node -e "setTimeout(() => {}, 1500)"`);
      await log.append(project, { session: "laptop", harness: "claude-code", source: "hook", machine: "elsewhere", folder: "C:\\site", branch: "claude/laptop", kind: "file-edited", files: ["x.ts"] });

      const watcher = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      let last = performance.now();
      let worst = 0;
      const ticking = setInterval(() => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
      }, 10);
      const started = performance.now();
      try {
        await resolveBranches(watcher, { allMergedPulls: async () => new Map(), allOpenPulls: async () => undefined, everyMs: 0, machine: "here" });
        // One more turn of the timers, so a stall at the look's very end is seen too.
        await new Promise((done) => setTimeout(done, 30));
      } finally {
        clearInterval(ticking);
      }
      assert.ok(performance.now() - started >= 1_000, "the look waited on the slow origin");
      assert.ok(worst < 500, `a timer waited ${Math.round(worst)} ms behind the look`);
    });
  } finally {
    await log.close();
  }
});

test("4.27 the same look reads, on this machine, each folder a session edited files in on the main line: whether its main holds uncommitted changes and whether its repository has no commit yet, written as a main-state line only when that changes", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      // Conduit's start: git init -b main, its first files staged, no commit yet.
      const repo = path.join(dir, "conduit");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "ci.yml"), "on: push\n");
      git(repo, "add", "ci.yml");
      const builder = { session: "builder", harness: "codex", source: "hook", folder: repo, branch: "main", machine: "here" } as const;
      await log.append(project, { ...builder, kind: "file-edited", files: [path.join(repo, "ci.yml")] });
      // Work on main on another machine is that machine's to look at.
      await log.append(project, { ...builder, session: "laptop", machine: "elsewhere", folder: "C:\\conduit", kind: "file-edited", files: ["C:\\conduit\\a.ts"] });

      const watcher = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { allMergedPulls: async () => new Map(), allOpenPulls: async () => new Map(), everyMs: 0, machine: "here" };
      const states = (lines: readonly Line[]) => lines.flatMap((line) => (line.kind === "main-state" ? [[line.of, line.dirty, line.unborn, line.session]] : []));

      assert.deepEqual(states(await resolveBranches(watcher, watch)), [[repo, true, true, "observer"]]);
      assert.deepEqual(await resolveBranches(watcher, watch), [], "nothing changed, nothing written");

      git(repo, "commit", "-q", "-m", "first");
      assert.deepEqual(states(await resolveBranches(watcher, watch)), [[repo, false, undefined, "observer"]]);

      writeFileSync(path.join(repo, "more.ts"), "x\n");
      assert.deepEqual(await resolveBranches(watcher, watch), [], "a folder found clean is looked at again only once someone works there again");
      await log.append(project, { ...builder, kind: "file-edited", files: ["more.ts"] });
      assert.deepEqual(states(await resolveBranches(watcher, watch)), [[repo, true, undefined, "observer"]], "an untracked file is uncommitted work too");

      git(repo, "switch", "-q", "-c", "claude/fix");
      assert.deepEqual(states(await resolveBranches(watcher, watch)), [[repo, false, undefined, "observer"]], "off the main line, the folder holds no work on main");
    });
  } finally {
    await log.close();
  }
});
