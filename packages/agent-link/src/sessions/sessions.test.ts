/**
 * Capability 4 · Sessions: one test per contract 4.1-4.5 in the agent link story. Lines are written
 * to the real agent activity log on the Postgres `pnpm test` provides, under projects named with
 * uniqueProjectName(), and the sessions are read back from it, judged at a chosen time.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openActivityLog, type ActivityLog, type Line, type NewLine } from "../activity/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { LONGEST_COMMAND_MS, QUIET_MS, readSessions } from "./index.js";

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
        state: "live",
        hooksRunning: true,
      },
    ]);
  });
});

test("4.2 with no line for longer than the quiet time the session reads as idle, and after its end line it reads as ended", async () => {
  await withProject(async (log, project) => {
    const start = await log.append(project, { ...CLAUDE, kind: "session-started", how: "startup" });
    const [atQuietTime] = await readSessions(log, project, { now: after(start, QUIET_MS) });
    assert.equal(atQuietTime?.state, "live", "still live at the end of the quiet time");
    const [pastQuietTime] = await readSessions(log, project, { now: after(start, QUIET_MS + 1) });
    assert.equal(pastQuietTime?.state, "idle", "idle once the quiet time has passed");

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
      [{ session: "claude-1", startedAt: start.at, lastSeenAt: resumed.at, state: "live" }],
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
        { session: "claude-1", label: "Claude Code", state: "live", hooksRunning: true },
        { session: "codex-1", label: "Codex", state: "live", hooksRunning: false },
      ],
    );
  });
});

test("4.5 a command that started 40 minutes ago and has not finished keeps its session live; once it finishes, or its turn ends, the quiet time counts again, and one older than the longest a command may run no longer counts", async () => {
  await withProject(async (log, project) => {
    const started = await log.append(project, { ...CLAUDE, kind: "command-started", command: "npm run build", call: "call-1" });
    const [running] = await readSessions(log, project, { now: after(started, 40 * 60 * 1000) });
    assert.equal(running?.state, "live", "live while its command runs");
    const [abandoned] = await readSessions(log, project, { now: after(started, LONGEST_COMMAND_MS + 1) });
    assert.equal(abandoned?.state, "idle", "a command older than the longest a command may run died with its window");

    const finished = await log.append(project, { ...CLAUDE, kind: "command-run", command: "npm run build", call: "call-1" });
    const [done] = await readSessions(log, project, { now: after(finished, QUIET_MS + 1) });
    assert.equal(done?.state, "idle", "idle once the quiet time has passed after it finished");

    // A command the harness refused never finishes: the end of its turn closes it.
    await log.append(project, { ...CLAUDE, kind: "command-started", command: "rm -rf build", call: "call-2" });
    const turn = await log.append(project, { ...CLAUDE, kind: "turn-ended" });
    const [refused] = await readSessions(log, project, { now: after(turn, QUIET_MS + 1) });
    assert.equal(refused?.state, "idle", "idle once the quiet time has passed after the turn ended");
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
