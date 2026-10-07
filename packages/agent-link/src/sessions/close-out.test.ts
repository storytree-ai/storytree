/**
 * Capability 4 · Sessions, close-out (ADR-0758 D2, D3): a session ends its work by recording whether
 * it is safe to close, and the reading checks a "yes" against its branches and its own running work
 * before letting it leave the list. Lines go to the real agent activity log on the Postgres
 * `pnpm test` provides; running work is a real process registered in a throwaway ledger.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { launchOwned } from "@storytree/processes";
import { stopOwned } from "@storytree/processes/stopping";
import { testChildArgs } from "@storytree/processes/testing";

import { openActivityLog, type ActivityLog, type Line } from "../activity/index.js";
import { readClaims } from "../claims/index.js";
import { removeTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { closeOut, LEAVE_MS, readSessions } from "./index.js";

async function withProject(body: (log: ActivityLog, project: string, home: string) => Promise<void>): Promise<void> {
  const log = await openActivityLog(testServerUrl());
  const home = await mkdtemp(path.join(tmpdir(), "close-out-"));
  try {
    await body(log, uniqueProjectName(), home);
  } finally {
    await log.close();
    await removeTempDir(home);
  }
}

function after(line: Line, ms: number): Date {
  return new Date(Date.parse(line.at) + ms);
}

const CLAUDE = { session: "claude-1", harness: "claude-code", source: "hook", folder: "/work/site", branch: "main" } as const;

test("4.11 close-out releases every own claim across branches and sources, leaving other holders and unfinished work intact", async () => {
  for (const safe of [true, false]) await withProject(async (log, project, home) => {
    await log.append(project, { ...CLAUDE, kind: "claimed", capability: "hook-cap", reason: "automatic edit claim" });
    await log.append(project, { ...CLAUDE, source: "tool", kind: "claimed", increment: "main-inc", reason: "before workspace" });
    await log.append(project, { ...CLAUDE, source: "tool", branch: "feature", kind: "claimed", capability: "tool-cap", reason: "in workspace" });
    await log.append(project, { ...CLAUDE, branch: "landed", kind: "claimed", capability: "merged-cap", reason: "landed work" });
    await log.append(project, { session: "observer", source: "hook", kind: "merged", holder: CLAUDE.session, capability: "merged-cap", branch: "landed", pr: 3 });
    await log.append(project, { ...CLAUDE, session: "other", kind: "claimed", capability: "other-cap", reason: "another session" });
    await log.append(project, { ...CLAUDE, kind: "file-edited", files: ["unfinished.ts"] });
    await log.append(project, { ...CLAUDE, kind: "main-state", of: CLAUDE.folder, dirty: true });
    const context = { log, project, ...CLAUDE };
    assert.deepEqual((await readClaims(log, project)).filter((one) => one.session === CLAUDE.session).map((one) => one.increment ?? one.capability), ["hook-cap", "main-inc", "tool-cap"], "a merge preserves claims on other branches, including unfinished main work");
    const answer = await closeOut(context, { safe, why: "handoff" }, { home });
    assert.deepEqual((await readClaims(log, project)).map((one) => one.capability), ["other-cap"]);
    assert.deepEqual(answer.released, ["hook-cap", "main-inc", "tool-cap"]);
    const session = (await readSessions(log, project)).find((one) => one.session === CLAUDE.session);
    assert.equal(session?.closeOut?.verified, false, "releasing claims does not certify unfinished work");
    assert.equal(session?.onMain, "outside-workspace");
    assert.deepEqual((await closeOut(context, { safe, why: "again" }, { home })).released, []);
  });
});

test("4.11 closing out records whether the session says it is safe to close, and why, and the session carries it", async () => {
  await withProject(async (log, project, home) => {
    await log.append(project, { ...CLAUDE, kind: "prompt-submitted" });
    const { line } = await closeOut({ log, project, session: "claude-1", harness: "claude-code", folder: "/work/site", branch: "main" }, { safe: false, why: "the look question waits on the owner" }, { home });
    assert.deepEqual({ kind: line.kind, safe: line.kind === "closed-out" && line.safe, why: line.kind === "closed-out" && line.why }, { kind: "closed-out", safe: false, why: "the look question waits on the owner" });
    const [session] = await readSessions(log, project, { now: after(line, 1_000) });
    assert.deepEqual(session?.closeOut, { safe: false, why: "the look question waits on the owner", at: line.at, verified: false, needsYou: "the look question waits on the owner" });
  });
});

test("4.12 a yes is checked, never trusted: it leaves the list at once when its branches are resolved and nothing of its own runs; otherwise it stays and needs you, naming the disagreement; a no stays with its why; a later prompt voids it", async () => {
  await withProject(async (log, project, home) => {
    const observer = { session: "observer", harness: "claude-code", source: "hook", folder: "/work/site", branch: "main" } as const;
    const who = (session: string, branch: string) => ({ log, project, session, harness: "claude-code", folder: `/work/site/.claude/worktrees/${branch}`, branch });
    const sessionOf = async (session: string, now: Date) => (await readSessions(log, project, { now })).find((one) => one.session === session);

    // Says safe, and its branch merged: gone at once.
    const done = { ...CLAUDE, session: "done", folder: "/work/site/.claude/worktrees/fix-done", branch: "fix-done" } as const;
    await log.append(project, { ...done, kind: "file-edited", files: ["a.ts"] });
    await log.append(project, { ...observer, kind: "branch-state", of: "fix-done", open: false, how: "merged", pr: 3 });
    const verified = await closeOut(who("done", "fix-done"), { safe: true, why: "PR 3 merged, tree clean" }, { home });
    const gone = await sessionOf("done", after(verified.line, 1_000));
    assert.deepEqual({ verified: gone?.closeOut?.verified, needsYou: gone?.closeOut?.needsYou, listing: gone?.listing }, { verified: true, needsYou: undefined, listing: "hidden" });

    // Says safe, but its branch is unmerged: it stays, needing you, and says why.
    const login = { ...CLAUDE, session: "login", folder: "/work/site/.claude/worktrees/fix-login", branch: "fix-login" } as const;
    await log.append(project, { ...login, kind: "file-edited", files: ["b.ts"] });
    const unmerged = await closeOut(who("login", "fix-login"), { safe: true, why: "all landed" }, { home });
    const stays = await sessionOf("login", after(unmerged.line, 1_000));
    assert.deepEqual({ verified: stays?.closeOut?.verified, needsYou: stays?.closeOut?.needsYou, listing: stays?.listing }, { verified: false, needsYou: "says safe, but fix-login is unmerged", listing: "listed" });

    // Says safe, but a run of its own still runs on its machine: recorded by the command, never by the agent.
    const busy = { ...CLAUDE, session: "busy", folder: "/work/site/.claude/worktrees/fix-busy", branch: "fix-busy" } as const;
    await log.append(project, { ...busy, kind: "file-edited", files: ["c.ts"] });
    await log.append(project, { ...observer, kind: "branch-state", of: "fix-busy", open: false, how: "merged", pr: 4 });
    const launched = await launchOwned({ home, owner: { session: "busy", harness: "claude-code" }, command: process.execPath, args: testChildArgs(), folder: home });
    assert.equal(launched.status, "tracked");
    try {
      const running = await closeOut(who("busy", "fix-busy"), { safe: true, why: "nothing left" }, { home });
      const held = await sessionOf("busy", after(running.line, 1_000));
      assert.deepEqual({ verified: held?.closeOut?.verified, needsYou: held?.closeOut?.needsYou, listing: held?.listing }, { verified: false, needsYou: "says safe, but 1 run of its own still runs", listing: "listed" });
    } finally {
      if (launched.status === "tracked") await stopOwned({ home, owner: { session: "busy", harness: "claude-code" }, targets: [launched.run.id] });
    }

    // Says not safe: it stays, needing you, with its why.
    const held = { ...CLAUDE, session: "held" } as const;
    await log.append(project, { ...held, kind: "prompt-submitted" });
    const no = await closeOut({ log, project, session: "held", harness: "claude-code", folder: "/work/site", branch: "main" }, { safe: false, why: "waiting on the owner's look" }, { home });
    const waits = await sessionOf("held", after(no.line, LEAVE_MS + 1));
    assert.deepEqual({ needsYou: waits?.closeOut?.needsYou, listing: waits?.listing }, { needsYou: "waiting on the owner's look", listing: "listed" }, "past the leave-after time, still listed");

    // A prompt after the close-out puts the session back to work: the close-out no longer stands.
    const prompt = await log.append(project, { ...done, kind: "prompt-submitted" });
    const back = await sessionOf("done", after(prompt, 1_000));
    assert.deepEqual({ closeOut: back?.closeOut, listing: back?.listing }, { closeOut: undefined, listing: "listed" });
  });
});

test("4.12 closing out asks GitHub whether the session's branch has merged, so a merge no hook recorded lets a yes leave the list", async () => {
  await withProject(async (log, project, home) => {
    const at = { ...CLAUDE, session: "landed", folder: home, branch: "fix-landed" } as const;
    await log.append(project, { ...at, kind: "file-edited", files: ["a.ts"] });
    const allMergedPulls = async () => new Map([["fix-landed", [{ number: 9, mergedAt: new Date(Date.now() + 1_000).toISOString() }]]]);
    const { line } = await closeOut({ log, project, session: "landed", harness: "claude-code", folder: home, branch: "fix-landed" }, { safe: true, why: "PR 9 merged" }, { home, look: { allMergedPulls } });
    const landed = (await readSessions(log, project, { now: after(line, 1_000) })).find((one) => one.session === "landed");
    assert.deepEqual({ verified: landed?.closeOut?.verified, listing: landed?.listing }, { verified: true, listing: "hidden" });
  });
});
