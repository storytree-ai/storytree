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
import type { MergedPulls } from "../claims/index.js";
import { git, withTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { resolveBranches } from "./index.js";

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

      const mergedPulls: MergedPulls = async (_folder, branch) => (branch === "claude/merged" ? [{ number: 12, mergedAt: new Date(Date.now() + 1_000).toISOString() }] : []);
      const watcher = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { mergedPulls, everyMs: 0, machine: "here" };
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
