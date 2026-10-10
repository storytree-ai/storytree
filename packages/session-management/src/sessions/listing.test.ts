/**
 * Capability 4 · Sessions, the listing (contract 4.13): the running-sessions list read out as
 * text for the command line, one block per session, or as JSON. Lines go to the real agent
 * activity log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openActivityLog } from "../activity/index.js";
import { withTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { sessionsListing } from "./index.js";

test("4.13 the sessions listing shows each listed session's state and why it needs you; a verified close-out shows only with all", async () => {
  const log = await openActivityLog(testServerUrl());
  try {
    const project = uniqueProjectName();
    const at = (session: string, branch: string) => ({ session, harness: "claude-code", source: "hook", folder: `/work/site/.claude/worktrees/${branch}`, branch }) as const;
    await log.append(project, { ...at("login", "fix-login"), kind: "prompt-submitted" });
    await log.append(project, { ...at("login", "fix-login"), kind: "turn-ended" });
    await log.append(project, { ...at("login", "fix-login"), kind: "closed-out", safe: true, why: "all landed", running: 0 });
    await log.append(project, { ...at("done", "fix-done"), kind: "file-edited", files: ["a.ts"] });
    await log.append(project, { ...at("done", "main"), kind: "branch-state", of: "fix-done", open: false, how: "merged", pr: 3 });
    const last = await log.append(project, { ...at("done", "fix-done"), kind: "closed-out", safe: true, why: "PR 3 merged", running: 0 });
    const now = new Date(Date.parse(last.at) + 1_000);

    const listed = await sessionsListing(log, project, { now, quietMs: 60_000, leaveMs: 60_000 });
    assert.match(listed, /login/);
    assert.match(listed, /waiting/);
    assert.match(listed, /says safe, but fix-login is unmerged/);
    assert.doesNotMatch(listed, /PR 3 merged/);

    const all = await sessionsListing(log, project, { now, quietMs: 60_000, leaveMs: 60_000, all: true });
    assert.match(all, /PR 3 merged/);

    const json = JSON.parse(await sessionsListing(log, project, { now, quietMs: 60_000, leaveMs: 60_000, json: true })) as { session: string; closeOut?: { needsYou?: string } }[];
    assert.deepEqual(json.map((one) => [one.session, one.closeOut?.needsYou]), [["login", "says safe, but fix-login is unmerged"]]);
  } finally {
    await log.close();
  }
});

test("4.13 the sessions listing asks GitHub about merges itself, so a merge no hook recorded never reads unmerged", async () => {
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (folder) => {
      const project = uniqueProjectName();
      const at = { session: "login", harness: "claude-code", source: "hook", folder: "/work/site/.claude/worktrees/fix-login", branch: "fix-login" } as const;
      await log.append(project, { ...at, kind: "prompt-submitted" });
      await log.append(project, { ...at, kind: "turn-ended" });
      const last = await log.append(project, { ...at, kind: "closed-out", safe: true, why: "PR 7 merged", running: 0 });
      const now = new Date(Date.parse(last.at) + 1_000);
      const allMergedPulls = async () => new Map([["fix-login", [{ number: 7, mergedAt: now.toISOString() }]]]);
      const look = { context: { log, project, folder, session: "reader", source: "tool" }, watch: { allMergedPulls } } as const;

      const json = JSON.parse(await sessionsListing(log, project, { now, quietMs: 60_000, leaveMs: 60_000, all: true, json: true, look })) as { session: string; closeOut?: { verified: boolean } }[];
      assert.deepEqual(json.filter((one) => one.session === "login").map((one) => one.closeOut?.verified), [true]);
    });
  } finally {
    await log.close();
  }
});

test("4.13 the sessions listing shows a session's work on main as its flag (4.26): the warning outside a workspace, the neutral label before a first commit", async () => {
  const log = await openActivityLog(testServerUrl());
  try {
    const project = uniqueProjectName();
    const conduit = { session: "builder", harness: "codex", source: "hook", folder: "/home/u/conduit", branch: "main", machine: "mint" } as const;
    await log.append(project, { ...conduit, kind: "file-edited", files: ["ci.yml"] });
    await log.append(project, { ...conduit, session: "observer", kind: "main-state", of: "/home/u/conduit", dirty: true, unborn: true });
    const last = await log.append(project, { ...conduit, kind: "session-ended", reason: "other" });
    const now = new Date(Date.parse(last.at) + 1_000);
    assert.match(await sessionsListing(log, project, { now }), /builder[^]*setting up git, first commit pending/);
    await log.append(project, { ...conduit, session: "observer", kind: "main-state", of: "/home/u/conduit", dirty: true });
    assert.match(await sessionsListing(log, project, { now }), /builder[^]*worked on main, outside a workspace/);
  } finally {
    await log.close();
  }
});
