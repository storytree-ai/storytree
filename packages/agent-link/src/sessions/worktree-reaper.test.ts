/**
 * Capability 4 · Sessions, contract 4.18: the hooks reap a merged worktree once every session that
 * worked in it has left (ADR-0790), on a real git repository and the real activity log on the
 * Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { openActivityLog } from "../activity/index.js";
import { claim, release } from "../claims/index.js";
import { git, withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { closeOut, readSessions, reapWorktrees } from "./index.js";

test("4.12, 4.18 a new admitted claim reopens a closed-out session and keeps its fresh worktree before any edit; a later close-out permits reaping", async () => {
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    const library = await storytree.openProject(project);
    const arc = await library.createArc({ title: "Continue work", intent: "Build the next piece", endState: "Both pieces landed" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Next piece", objective: "Continue after close-out", body: "Claim a fresh workspace" });
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      git(repo, "commit", "-q", "--allow-empty", "-m", "first");
      const home = path.join(dir, "ledger");
      mkdirSync(home);
      const who = { log, library, project, session: "continuing", harness: "codex", folder: repo, branch: "main" };
      const session = async () => (await readSessions(log, project)).find((one) => one.session === who.session)!;
      await closeOut(who, { safe: true, why: "Previous work finished" }, { home });
      assert.equal((await session()).closeOut?.verified, true);
      assert.equal((await session()).listing, "hidden");

      const folder = path.join(dir, "next");
      const branch = "codex/next";
      git(repo, "worktree", "add", "-q", "-b", branch, folder, "main");
      const next = { ...who, folder, branch };
      assert.equal((await claim(next, increment.id, "Build the next piece")).ok, true);
      // A fresh branch is already in main: branch resolution must not mask the stale close-out.
      const observer = { log, project, session: "observer", harness: "codex", folder: repo, source: "hook" } as const;
      await log.append(project, { session: observer.session, source: "hook", kind: "branch-state", of: branch, open: false, how: "not-ahead" });
      const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
      assert.deepEqual(await reapWorktrees(observer, watch), [], "the fresh claimed worktree stays before any edit");
      assert.equal(existsSync(folder), true);
      assert.equal(git(repo, "branch", "--list", "--format=%(refname:short)", branch).trim(), branch);
      const reopened = await session();
      assert.equal(reopened.closeOut, undefined);
      assert.equal(reopened.listing, "listed");
      assert.equal(reopened.state, "working");

      assert.equal((await release(next, increment.id)).ok, true);
      await closeOut(next, { safe: true, why: "Next work finished, nothing left running" }, { home });
      assert.equal((await session()).closeOut?.verified, true);
      assert.deepEqual(await reapWorktrees(observer, watch), [folder]);
      assert.equal(existsSync(folder), false);
      assert.equal(git(repo, "branch", "--list", branch).trim(), "");
    });
  } finally {
    await log.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});

test("4.18 a clean worktree whose head is in main, and whose sessions have all closed out or been archived, is removed with its branch; a dirty, unmerged, locked, unknown, still-used, protected or hook-running one stays", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
      git(repo, "add", "a.txt", ".gitignore");
      git(repo, "commit", "-q", "-m", "first");
      const trees = path.join(repo, ".claude", "worktrees");
      const tree = (name: string) => {
        git(repo, "worktree", "add", "-q", "-b", `claude/${name}`, path.join(trees, name), "main");
        return path.join(trees, name);
      };
      const [merged, archived, dirty, ahead, locked, unknown, used, guarded, running] =
        ["merged", "archived", "dirty", "ahead", "locked", "unknown", "used", "guarded", "running"].map(tree) as [string, string, string, string, string, string, string, string, string];
      writeFileSync(path.join(dirty, "stray.txt"), "not committed\n");
      writeFileSync(path.join(ahead, "b.txt"), "b\n");
      git(ahead, "add", "b.txt");
      git(ahead, "commit", "-q", "-m", "work");
      git(repo, "worktree", "lock", locked);
      mkdirSync(path.join(merged, "node_modules", "deep"), { recursive: true });
      writeFileSync(path.join(merged, "node_modules", "deep", "x.js"), "");

      const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
      const left = async (session: string, folder: string, how: "closed-out" | "archived") => {
        const branch = `claude/${path.basename(folder)}`;
        await log.append(project, { ...here, session, folder: path.join(folder, "packages"), branch, kind: "file-edited", files: ["x.ts"] });
        await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: branch, open: false, how: "not-ahead" });
        if (how === "closed-out") await log.append(project, { ...here, session, folder, branch, kind: "closed-out", safe: true, why: "merged", running: 0 });
        else await log.append(project, { ...here, session: "observer", folder: repo, kind: "session-archived", of: session, app: "claude-desktop" });
      };
      await left("s-merged", merged, "closed-out");
      await left("s-archived", archived, "archived");
      await left("s-dirty", dirty, "closed-out");
      await left("s-ahead", ahead, "archived");
      await left("s-locked", locked, "closed-out");
      await left("s-guarded", guarded, "closed-out");
      await left("s-running", running, "closed-out");
      // One session left the worktree, but another still works in it.
      await left("s-used", used, "closed-out");
      await log.append(project, { ...here, session: "s-still", folder: used, branch: "claude/used", kind: "file-edited", files: ["y.ts"] });

      const emptied: string[] = [];
      const reaped = await reapWorktrees(
        { log, project, folder: running, session: "observer", harness: "claude-code", source: "hook" },
        { everyMs: 0, budgetMs: 60_000, protect: [path.join(guarded, "packages", "agent-link", "dist", "storytree-hook.mjs")], empty: (trash) => { emptied.push(trash); rmSync(trash, { recursive: true, force: true }); } },
      );

      assert.deepEqual([...reaped].sort(), [archived, merged].sort());
      for (const gone of [archived, merged]) assert.equal(existsSync(gone), false, `${gone} is deleted`);
      for (const kept of [dirty, ahead, locked, unknown, used, guarded, running]) assert.equal(existsSync(kept), true, `${kept} stays`);
      const listed = git(repo, "worktree", "list", "--porcelain");
      assert.equal(listed.includes("/merged\n"), false, "unregistered");
      assert.equal(listed.includes("/archived\n"), false, "unregistered");
      const branches = git(repo, "branch", "--format=%(refname:short)").split("\n");
      assert.equal(branches.includes("claude/merged"), false, "its merged branch is deleted");
      assert.equal(branches.includes("claude/ahead"), true);
      assert.equal(emptied.length, 1, "the trash is handed on to be emptied once");
    });
  } finally {
    await log.close();
  }
});
