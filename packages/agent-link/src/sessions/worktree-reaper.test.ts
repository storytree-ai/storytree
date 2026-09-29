/**
 * Capability 4 · Sessions, contract 4.13: the hooks reap a merged worktree once every session that
 * worked in it has left (ADR-0790), on a real git repository and the real activity log on the
 * Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { openActivityLog } from "../activity/index.js";
import { git, withTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { reapWorktrees } from "./index.js";

test("4.13 a clean worktree whose head is in main, and whose sessions have all closed out or been archived, is removed with its branch; a dirty, unmerged, locked, unknown, still-used, protected or hook-running one stays", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      git(repo, "add", "a.txt");
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
        { everyMs: 0, protect: [path.join(guarded, "packages", "agent-link", "dist", "storytree-hook.mjs")], empty: (trash) => { emptied.push(trash); rmSync(trash, { recursive: true, force: true }); } },
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
