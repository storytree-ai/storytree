/**
 * Capability 4 · Sessions: one test per contract 4.1-4.5 in the agent link story. Lines are written
 * to the real agent activity log on the Postgres `pnpm test` provides, under projects named with
 * uniqueProjectName(), and the sessions are read back from it, judged at a chosen time.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openActivityLog, type ActivityLog, type Line, type NewLine } from "../activity/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { LEAVE_MS, LONGEST_COMMAND_MS, QUIET_MS, readSessions } from "./index.js";

/** Run `body` with the log open on the test server and a fresh project to write in. */
async function withProject(body: (log: ActivityLog, project: string) => Promise<void>): Promise<void> {
  const log = await openActivityLog(testServerUrl());
  try {
    await body(log, uniqueProjectName());
  } finally {
    await log.close();
  }
}

/** `ms` milliseconds after the time `line` was written. */
function after(line: Line, ms: number): Date {
  return new Date(Date.parse(line.at) + ms);
}

const CLAUDE = { session: "claude-1", harness: "claude-code", source: "hook", folder: "/work/site" } as const;

test('4.1 a start line makes a live session labelled "Claude Code", with its folder, when it started and when it was last seen', async () => {
  await withProject(async (log, project) => {
    const start = await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    const edit = await log.append(project, { ...CLAUDE, kind: "file-edited", files: ["/work/site/index.html"] });
    assert.deepEqual(await readSessions(log, project, { now: after(edit, 1_000) }), [
      {
        session: "claude-1",
        harness: "claude-code",
        label: "Claude Code",
        folder: "/work/site",
        worktrees: ["/work/site"],
        startedAt: start.at,
        lastSeenAt: edit.at,
        state: "working",
        hooksRunning: true,
        branches: [],
        openWork: [],
        archived: false,
        listing: "listed",
      },
    ]);
  });
});

test("4.2 with no line for longer than the quiet time the session reads as idle, and after its end line it reads as ended", async () => {
  await withProject(async (log, project) => {
    const start = await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    const [atQuietTime] = await readSessions(log, project, { now: after(start, QUIET_MS) });
    assert.equal(atQuietTime?.state, "working", "still live at the end of the quiet time");
    const [pastQuietTime] = await readSessions(log, project, { now: after(start, QUIET_MS + 1) });
    assert.equal(pastQuietTime?.state, "waiting", "idle once the quiet time has passed");

    const end = await log.append(project, { ...CLAUDE, kind: "session-ended", reason: "other" });
    const [ended] = await readSessions(log, project, { now: after(end, 1_000) });
    assert.equal(ended?.state, "ended", "ended by its end line, however recent");
    assert.equal(ended?.lastSeenAt, end.at);
  });
});

test("4.3 a resumed window continues the same session instead of starting a second one", async () => {
  await withProject(async (log, project) => {
    const start = await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    await log.append(project, { ...CLAUDE, kind: "session-ended", reason: "other" });
    const resumed = await log.append(project, { ...CLAUDE, kind: "session-started", how: "resume" });
    const sessions = await readSessions(log, project, { now: after(resumed, 1_000) });
    assert.equal(sessions.length, 1, "one session");
    assert.deepEqual(
      sessions.map(({ session, startedAt, lastSeenAt, state }) => ({ session, startedAt, lastSeenAt, state })),
      [{ session: "claude-1", startedAt: start.at, lastSeenAt: resumed.at, state: "working" }],
    );
  });
});

test('4.4 a Codex session whose hooks never ran, but which calls a storytree tool, still appears and is flagged "hooks not running"', async () => {
  await withProject(async (log, project) => {
    await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    const codex = { session: "codex-1", harness: "codex", source: "tool", folder: "/work/site" } satisfies Partial<NewLine>;
    const called = await log.append(project, { ...codex, kind: "tool-called", tool: "show_plan" });
    const sessions = await readSessions(log, project, { now: after(called, 1_000) });
    assert.deepEqual(
      sessions.map(({ session, label, state, hooksRunning }) => ({ session, label, state, hooksRunning })),
      [
        { session: "claude-1", label: "Claude Code", state: "working", hooksRunning: true },
        { session: "codex-1", label: "Codex", state: "working", hooksRunning: false },
      ],
    );
  });
});

test("4.5 a command that started 40 minutes ago and has not finished keeps its session live; once it finishes, or its turn ends, the quiet time counts again, and one older than the longest a command may run no longer counts", async () => {
  await withProject(async (log, project) => {
    // Codex sets no limit of its own on a command; Claude Code's is claims' 5.6.
    const CODEX = { ...CLAUDE, harness: "codex" } as const;
    const started = await log.append(project, { ...CODEX, kind: "command-started", command: "npm run build", call: "call-1" });
    const [running] = await readSessions(log, project, { now: after(started, 40 * 60 * 1000) });
    assert.equal(running?.state, "working", "live while its command runs");
    const [abandoned] = await readSessions(log, project, { now: after(started, LONGEST_COMMAND_MS + 1) });
    assert.equal(abandoned?.state, "gone", "a command older than the longest a command may run died with its window, and the silent session with it (4.7)");

    const finished = await log.append(project, { ...CODEX, kind: "command-run", command: "npm run build", call: "call-1" });
    const [done] = await readSessions(log, project, { now: after(finished, QUIET_MS + 1) });
    assert.equal(done?.state, "waiting", "idle once the quiet time has passed after it finished");

    // A command the harness refused never finishes: the end of its turn closes it.
    await log.append(project, { ...CLAUDE, kind: "command-started", command: "rm -rf build", call: "call-2" });
    const turn = await log.append(project, { ...CLAUDE, kind: "turn-ended" });
    const [refused] = await readSessions(log, project, { now: after(turn, QUIET_MS + 1) });
    assert.equal(refused?.state, "waiting", "idle once the quiet time has passed after the turn ended");
  });
});

test("4.6 a session is its harness id, not a folder: one whose lines name two worktrees lists both, in the order it worked in them (ADR-0749 D2)", async () => {
  await withProject(async (log, project) => {
    await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    await log.append(project, { ...CLAUDE, folder: "/work/site/.claude/worktrees/fix", kind: "file-edited", files: ["a.ts"] });
    const edit = await log.append(project, { ...CLAUDE, kind: "turn-ended" });
    const [session] = await readSessions(log, project, { now: after(edit, 1_000) });
    assert.equal(session?.folder, "/work/site", "the folder it started in");
    assert.deepEqual(session?.worktrees, ["/work/site", "/work/site/.claude/worktrees/fix"]);
  });
});

test("4.7 a session silent for longer than a command may run has stopped reporting: it reads as gone, never as ended, since no end line said so (ADR-0749)", async () => {
  await withProject(async (log, project) => {
    const start = await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    const [idle] = await readSessions(log, project, { now: after(start, LONGEST_COMMAND_MS) });
    assert.equal(idle?.state, "waiting", "idle up to the limit");
    const [gone] = await readSessions(log, project, { now: after(start, LONGEST_COMMAND_MS + 1) });
    assert.equal(gone?.state, "gone", "gone past it");
  });
});

test("4.8 working comes from turn state (ADR-0754 D5): a prompt makes its session working until its turn ends, however long the turn is silent; its end makes it waiting at once; a turn that ends with background tasks still running leaves their command running", async () => {
  await withProject(async (log, project) => {
    await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    const prompt = await log.append(project, { ...CLAUDE, kind: "prompt-submitted" });
    const [longTurn] = await readSessions(log, project, { now: after(prompt, 3 * QUIET_MS) });
    assert.equal(longTurn?.state, "working", "a long turn that writes no line stays working");
    await log.append(project, { ...CLAUDE, kind: "session-started", how: "compact" });
    const [compacted] = await readSessions(log, project, { now: after(prompt, 3 * QUIET_MS) });
    assert.equal(compacted?.state, "working", "compacting mid-turn does not end the turn");

    const turn = await log.append(project, { ...CLAUDE, kind: "turn-ended", background: 0 });
    const [waiting] = await readSessions(log, project, { now: after(turn, 1_000) });
    assert.equal(waiting?.state, "waiting", "waiting as soon as the turn ends, not after the quiet time");

    await log.append(project, { ...CLAUDE, kind: "prompt-submitted" });
    await log.append(project, { ...CLAUDE, kind: "command-started", command: "pnpm test", call: "call-bg" });
    const backgrounded = await log.append(project, { ...CLAUDE, kind: "turn-ended", background: 1 });
    const [running] = await readSessions(log, project, { now: after(backgrounded, 3 * QUIET_MS) });
    assert.equal(running?.state, "working", "its background command is still running");
    const finished = await log.append(project, { ...CLAUDE, kind: "command-run", command: "pnpm test", call: "call-bg" });
    const [done] = await readSessions(log, project, { now: after(finished, 1_000) });
    assert.equal(done?.state, "waiting", "waiting once the background command finishes");
  });
});

test("4.9 who is listed (ADR-0754 D4): a session holding unmerged work stays listed whatever its end; once its work resolves it leaves on its end line or after the leave-after quiet time, counted from the resolution; a desktop session shows done instead, and leaves only when archived", async () => {
  await withProject(async (log, project) => {
    const observer = { session: "observer", harness: "claude-code", source: "hook", folder: "/work/site", branch: "main" } as const;
    const listing = async (session: string, now: Date) => (await readSessions(log, project, { now })).find((one) => one.session === session);

    // A terminal session that worked on a branch and ended: its work is open, so it stays.
    const terminal = { ...CLAUDE, session: "terminal", folder: "/work/site/.claude/worktrees/fix", branch: "claude/fix" } as const;
    await log.append(project, { ...terminal, kind: "file-edited", files: ["a.ts"] });
    const ended = await log.append(project, { ...terminal, kind: "session-ended", reason: "other" });
    const open = await listing("terminal", after(ended, 2 * LEAVE_MS));
    assert.deepEqual(open?.openWork, ["claude/fix"]);
    assert.equal(open?.listing, "listed", "open work keeps it listed long after its end");
    // A merged line names the claim's branch, not the observer's: it adds no work to the observer.
    await log.append(project, { ...observer, kind: "merged", increment: "inc-1", holder: "terminal", branch: "claude/other", pr: 7 });
    assert.deepEqual((await listing("observer", after(ended, 1_000)))?.branches, []);
    await log.append(project, { ...observer, kind: "branch-state", of: "claude/fix", open: false, how: "merged", pr: 12 });
    assert.equal((await listing("terminal", after(ended, 1_000)))?.listing, "hidden", "resolved and ended: gone at once");

    // A terminal session that never branched and never ended leaves after the leave-after quiet time.
    const quiet = { ...CLAUDE, session: "quiet", branch: "main" } as const;
    const last = await log.append(project, { ...quiet, kind: "session-started", how: "startup" });
    assert.deepEqual((await listing("quiet", after(last, LEAVE_MS)))?.listing, "listed");
    assert.deepEqual((await listing("quiet", after(last, LEAVE_MS + 1)))?.listing, "hidden");
    assert.equal((await readSessions(log, project, { now: after(last, 60 * 60 * 1000 + 1), leaveMs: 60 * 60 * 1000 })).find((one) => one.session === "quiet")?.listing, "hidden", "a leave-after of one hour");

    // The quiet time counts from the resolution when that came after the session's last line.
    const late = { ...CLAUDE, session: "late", folder: "/work/site/.claude/worktrees/late", branch: "claude/late" } as const;
    const worked = await log.append(project, { ...late, kind: "turn-ended" });
    const resolved = await log.append(project, { ...observer, kind: "branch-state", of: "claude/late", open: false, how: "not-ahead" }, { at: new Date(Date.parse(worked.at) + 60_000).toISOString() });
    assert.equal((await listing("late", after(worked, LEAVE_MS + 1)))?.listing, "listed", "resolved only later");
    assert.equal((await listing("late", after(resolved, LEAVE_MS + 1)))?.listing, "hidden");
    await log.append(project, { ...observer, kind: "branch-state", of: "claude/late", open: true, how: "ahead" });
    assert.equal((await listing("late", after(resolved, LEAVE_MS + 1)))?.listing, "listed", "reopened work is open again");

    // A desktop session: its end line does not remove it; resolved and settled it shows done until archived.
    const desktop = { ...CLAUDE, session: "desktop", branch: "main" } as const;
    await log.append(project, { ...observer, kind: "session-unarchived", of: "desktop", app: "claude-desktop" });
    const desktopEnd = await log.append(project, { ...desktop, kind: "session-ended", reason: "other" });
    const done = await listing("desktop", after(desktopEnd, 1_000));
    assert.deepEqual({ app: done?.app, archived: done?.archived, listing: done?.listing }, { app: "claude-desktop", archived: false, listing: "done" });
    await log.append(project, { ...observer, kind: "session-archived", of: "desktop", app: "claude-desktop" });
    assert.equal((await listing("desktop", after(desktopEnd, 1_000)))?.listing, "hidden", "archived: removed at once");
    await log.append(project, { ...observer, kind: "session-unarchived", of: "desktop", app: "claude-desktop" });
    assert.equal((await listing("desktop", after(desktopEnd, 1_000)))?.listing, "done", "un-archived: back");
  });
});

test("4.20 a line about other sessions (a branch's state, what an app keeps) never makes its writer a session: a person or the app that looked is not listed", async () => {
  await withProject(async (log, project) => {
    const worker = await log.append(project, { ...CLAUDE, branch: "fix-login", kind: "file-edited", files: ["a.ts"] });
    const looker = { session: "person:mick", source: "tool", folder: "/work/site" } as const;
    await log.append(project, { ...looker, kind: "branch-state", of: "fix-login", open: false, how: "merged", pr: 4 });
    await log.append(project, { ...looker, kind: "session-archived", of: "claude-1", app: "claude-desktop" });
    const sessions = await readSessions(log, project, { now: after(worker, 1_000) });
    assert.deepEqual(sessions.map((one) => [one.session, one.openWork]), [["claude-1", []]]);
  });
});
