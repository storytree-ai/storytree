/**
 * Capability 4 · Sessions: one test per contract 4.1-4.5 in the agent link story. Lines are written
 * to the real agent activity log on the Postgres `pnpm test` provides, under projects named with
 * uniqueProjectName(), and the sessions are read back from it, judged at a chosen time.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openActivityLog, type ActivityLog, type Line, type NewLine } from "../activity/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { claimsFrom, readClaims } from "../claims/index.js";
import { LEAVE_MS, LONGEST_COMMAND_MS, QUIET_MS, readSessions, readSessionStates, sessionsFrom } from "./index.js";

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
        branchesByFolder: [],
        running: [],
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
    // A merged line names the claim's branch, not the observer's: it makes the observer no session with work.
    await log.append(project, { ...observer, kind: "merged", increment: "inc-1", holder: "terminal", branch: "claude/other", pr: 7 });
    assert.equal(await listing("observer", after(ended, 1_000)), undefined);
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

test("4.22 a session reads, for each folder it worked in, the branches it recorded there and whether each still holds open work: the main line is no branch, and a branch recorded with no folder is placed in the folder it last worked in", async () => {
  await withProject(async (log, project) => {
    const fix = "/work/site/.claude/worktrees/fix";
    const old = "/work/site/.claude/worktrees/old";
    const observer = { session: "observer", harness: "claude-code", source: "hook", folder: "/work/site", branch: "main" } as const;
    await log.append(project, { ...CLAUDE, folder: "/work/site", branch: "main", kind: "session-started", how: "startup" });
    await log.append(project, { ...CLAUDE, folder: old, branch: "claude/old", kind: "file-edited", files: ["a.ts"] });
    await log.append(project, { ...CLAUDE, folder: fix, branch: "claude/fix", kind: "file-edited", files: ["b.ts"] });
    // A line that names a branch but no folder (written by a tool with none to name).
    const last = await log.append(project, { session: CLAUDE.session, harness: "claude-code", source: "tool", branch: "claude/stray", kind: "claimed", increment: "inc-1", reason: "stray" });
    await log.append(project, { ...observer, kind: "branch-state", of: "claude/old", open: false, how: "merged", pr: 9 });
    const [session] = await readSessions(log, project, { now: after(last, 1_000) });
    assert.deepEqual(session?.branchesByFolder, [
      { folder: old, branch: "claude/old", open: false },
      { folder: fix, branch: "claude/fix", open: true },
      { folder: fix, branch: "claude/stray", open: true },
    ]);
  });
});

test("4.23 a session reads the commands it started and has not seen finish, each with its command and when it started, background ones a turn left running included; a finished command, or one a turn ended without leaving background tasks, is not listed (the same reading that keeps a session working, 4.5, 4.8)", async () => {
  await withProject(async (log, project) => {
    await log.append(project, { ...CLAUDE, kind: "prompt-submitted" });
    const test = await log.append(project, { ...CLAUDE, kind: "command-started", command: "pnpm run test --full", call: "call-test" });
    await log.append(project, { ...CLAUDE, kind: "command-started", command: "git status", call: "call-git" });
    await log.append(project, { ...CLAUDE, kind: "command-run", command: "git status", call: "call-git" });
    const background = await log.append(project, { ...CLAUDE, kind: "command-started", command: "gh pr checks --watch", call: "call-watch" });
    const running = async (line: Line, ms: number) => (await readSessions(log, project, { now: after(line, ms) }))[0]?.running.map(({ command, since }) => [command, since]);
    assert.deepEqual(await running(background, 1_000), [["pnpm run test --full", test.at], ["gh pr checks --watch", background.at]], "a finished command is not listed");
    const turn = await log.append(project, { ...CLAUDE, kind: "turn-ended", background: 2 });
    assert.deepEqual(await running(turn, 3 * QUIET_MS), [["pnpm run test --full", test.at], ["gh pr checks --watch", background.at]], "left running in the background, past the limit on one a turn waits for");
    const done = await log.append(project, { ...CLAUDE, kind: "command-run", command: "pnpm run test --full", call: "call-test" });
    assert.deepEqual(await running(done, 1_000), [["gh pr checks --watch", background.at]]);
    await log.append(project, { ...CLAUDE, kind: "prompt-submitted" });
    const ended = await log.append(project, { ...CLAUDE, kind: "turn-ended", background: 0 });
    assert.deepEqual(await running(ended, 1_000), [], "a turn that leaves no background task closes every command");
  });
});

test("4.26 work on main is never silently dropped (ADR-0906): an ended session that edited files on main, in a repository with no commit yet whose main a look found uncommitted, stays listed labelled first-commit pending; once committed, uncommitted work on main is flagged outside a workspace; a live session holding an increment claimed on main is flagged too; once the work is committed it leaves as 4.9 says", async () => {
  await withProject(async (log, project) => {
    const listing = async (session: string, now: Date) => (await readSessions(log, project, { now })).find((one) => one.session === session);
    const observer = { session: "observer", harness: "claude-code", source: "hook", folder: "/elsewhere", branch: "main", machine: "mint" } as const;

    // Conduit's incident (app-setup evidence, first-build/github.md): git init -b main, an increment claimed,
    // files staged before the first commit, then the session ended with no close-out while GitHub's login waited.
    const conduit = { session: "builder", harness: "codex", source: "hook", folder: "/home/u/conduit-codex", branch: "main", machine: "mint" } as const;
    await log.append(project, { ...conduit, kind: "session-started", how: "startup" });
    await log.append(project, { ...conduit, source: "tool", kind: "claimed", increment: "inc-ci", reason: "Review changes with official CI" });
    await log.append(project, { ...conduit, kind: "file-edited", files: ["/home/u/conduit-codex/.github/workflows/ci.yml", "/home/u/.codex/notes.md"] });
    await log.append(project, { ...observer, kind: "main-state", of: "/home/u/conduit-codex", dirty: true, unborn: true });
    const ended = await log.append(project, { ...conduit, kind: "session-ended", reason: "other" });
    const pending = await listing("builder", after(ended, 2 * LEAVE_MS));
    assert.deepEqual([pending?.state, pending?.listing, pending?.onMain], ["ended", "listed", "first-commit-pending"], "unfinished first-commit work keeps it listed, labelled, not warned");

    await log.append(project, { ...observer, kind: "main-state", of: "/home/u/conduit-codex", dirty: true });
    assert.equal((await listing("builder", after(ended, 2 * LEAVE_MS)))?.onMain, "outside-workspace", "after its first commit, uncommitted work on main is a warning");
    const clean = await log.append(project, { ...observer, kind: "main-state", of: "/home/u/conduit-codex", dirty: false });
    const left = await listing("builder", after(clean, 1_000));
    assert.deepEqual([left?.listing, left?.onMain], ["hidden", undefined], "committed: nothing left on main, so it ended and leaves");

    // The same folder's main dirty on another machine says nothing of this one's.
    await log.append(project, { ...observer, machine: "laptop", kind: "main-state", of: "/home/u/conduit-codex", dirty: true });
    assert.equal((await listing("builder", after(clean, 1_000)))?.onMain, undefined);

    // A file edited outside the folder (a memory note) is no work on main, however dirty main is.
    const memo = { ...CLAUDE, session: "memo", branch: "main", machine: "mint" } as const;
    await log.append(project, { ...memo, kind: "file-edited", files: ["/home/u/.claude/memory/note.md"] });
    await log.append(project, { ...observer, kind: "main-state", of: "/work/site", dirty: true });
    const memoEnd = await log.append(project, { ...memo, kind: "session-ended", reason: "other" });
    assert.equal((await listing("memo", after(memoEnd, 1_000)))?.listing, "hidden");

    // A live session holding an increment it claimed on main is flagged, a capability claimed there is not.
    const lane = { ...CLAUDE, session: "lane", folder: "/work/clean", branch: "main", machine: "mint" } as const;
    await log.append(project, { ...lane, source: "tool", kind: "claimed", capability: "cap-1", reason: "a capability" });
    const capOnly = await log.append(project, { ...lane, kind: "turn-ended" });
    assert.equal((await listing("lane", after(capOnly, 1_000)))?.onMain, undefined);
    const claimed = await log.append(project, { ...lane, source: "tool", kind: "claimed", increment: "inc-2", reason: "on main" });
    const flagged = await listing("lane", after(claimed, 2 * LEAVE_MS));
    assert.deepEqual([flagged?.listing, flagged?.onMain], ["listed", "outside-workspace"], "the claim keeps it listed past the leave-after time");
    await log.append(project, { ...lane, source: "tool", kind: "closed-out", safe: true, why: "all done", running: 0 });
    assert.deepEqual((await listing("lane", after(claimed, 1_000)))?.closeOut?.needsYou, "says safe, but worked on main, outside a workspace", "a yes is not verified while work on main stands");
    const released = await log.append(project, { ...lane, source: "tool", kind: "released", increment: "inc-2" });
    assert.equal((await listing("lane", after(released, 1_000)))?.onMain, undefined);
  });
});

test("4.28 the sessions read from the lines that decide them, and the claims read from those standing, are what a fold of the whole log gives at any time, from a share of its lines; the list's own read leaves out only sessions the list hides, and the status line's states agree (contract 2.7)", async () => {
  await withProject(async (log, project) => {
    const write = (line: Record<string, unknown>) => log.append(project, line as NewLine);
    const a = { session: "a", harness: "claude-code", source: "hook", folder: "/w/a", branch: "feat-a" } as const;
    const b = { session: "b", harness: "codex", source: "hook", folder: "/w/b", branch: "feat-b" } as const;
    const c = { session: "c", harness: "claude-code", source: "hook", folder: "/w/main", branch: "main", machine: "box" } as const;
    const d = { session: "d", harness: "claude-code", source: "hook" } as const;
    const watcher = { session: "app:box", source: "tool", folder: "/w/main", machine: "box" } as const;

    // a works in its worktree through many commands, claims, and leaves one running.
    await write({ ...a, kind: "session-started", how: "startup" });
    for (let turn = 0; turn < 3; turn++) {
      await write({ ...a, kind: "prompt-submitted" });
      for (let step = 0; step < 5; step++) {
        await write({ ...a, kind: "command-started", command: `step ${turn}.${step}`, call: `a-${turn}-${step}` });
        await write({ ...a, kind: "command-run", command: `step ${turn}.${step}`, call: `a-${turn}-${step}` });
      }
      await write({ ...a, kind: "file-edited", files: [`/w/a/src/${turn}.ts`] });
      await write({ ...a, kind: "turn-ended" });
    }
    await write({ ...a, source: "tool", kind: "claimed", capability: "cap-1", reason: "building" });
    await write({ ...a, kind: "prompt-submitted" });
    await write({ ...a, kind: "command-started", command: "pnpm test", call: "a-run" });

    // b claims and releases, finishes a command before its start is written, renames itself, closes out; its branch merges and an app archives it.
    await write({ ...b, kind: "session-started", how: "startup" });
    await write({ ...b, source: "tool", kind: "claimed", increment: "inc-1", reason: "the increment" });
    await write({ ...b, kind: "command-run", command: "quick", call: "b-1" });
    await write({ ...b, kind: "command-started", command: "quick", call: "b-1" });
    await write({ ...b, source: "tool", kind: "released", increment: "inc-1" });
    await write({ ...b, source: "tool", kind: "session-named", title: "first name" });
    await write({ ...b, source: "tool", kind: "session-named", title: "second name" });
    await write({ ...b, source: "tool", kind: "closed-out", safe: true, why: "done", running: 0 });
    await write({ ...watcher, kind: "branch-state", of: "feat-b", open: false, how: "merged", pr: 9 });

    // c edits on main, and outside its folder; a look finds main dirty; it ends.
    await write({ ...c, kind: "session-started", how: "startup" });
    await write({ ...c, kind: "file-edited", files: ["/w/main/readme.md"] });
    await write({ ...c, kind: "file-edited", files: ["/elsewhere/note.md"] });
    await write({ ...watcher, kind: "main-state", of: "/w/main", dirty: true });
    await write({ ...c, kind: "session-ended", reason: "exit" });

    // d moves between two worktrees, compacts mid-turn, leaves a background task running, and takes a's claim over.
    await write({ ...d, folder: "/w/d1", branch: "d1", kind: "session-started", how: "startup" });
    for (let turn = 0; turn < 4; turn++) {
      const where = turn % 2 === 0 ? { folder: "/w/d1", branch: "d1" } : { folder: "/w/d2", branch: "d2" };
      await write({ ...d, ...where, kind: "prompt-submitted" });
      await write({ ...d, ...where, kind: "command-started", command: `d ${turn}`, call: `d-${turn}` });
      await write({ ...d, ...where, kind: "command-run", command: `d ${turn}`, call: `d-${turn}` });
      await write({ ...d, ...where, kind: "turn-ended" });
    }
    await write({ ...d, folder: "/w/d2", branch: "d2", kind: "prompt-submitted" });
    await write({ ...d, folder: "/w/d2", branch: "d2", kind: "session-started", how: "compact" });
    await write({ ...d, folder: "/w/d2", branch: "d2", kind: "command-started", command: "serve", call: "d-bg" });
    await write({ ...d, folder: "/w/d2", branch: "d2", kind: "turn-ended", background: 1 });
    await write({ ...d, folder: "/w/d1", branch: "d1", source: "tool", kind: "claimed", capability: "cap-1", reason: "taking over", takenOverFrom: "a" });
    await write({ ...watcher, kind: "session-unarchived", of: "d", app: "claude-desktop" });
    await write({ ...watcher, kind: "session-described", of: "d", app: "claude-desktop", title: "D's work" });
    await write({ ...watcher, kind: "session-archived", of: "b", app: "codex" });
    const last = await write({ ...a, kind: "file-edited", files: ["/w/a/src/last.ts"] });

    const { lines } = await log.since(project, 0);
    const shown = (sessions: readonly { listing: string }[]) => sessions.filter((session) => session.listing !== "hidden");
    const working = (sessions: readonly { session: string; state: string }[]) => sessions.filter((session) => session.state === "working").map((session) => session.session);
    for (const ms of [1_000, 2 * QUIET_MS, 2 * LEAVE_MS, LONGEST_COMMAND_MS + 60_000]) {
      const options = { now: after(last, ms), quietMs: QUIET_MS, leaveMs: LEAVE_MS };
      const whole = sessionsFrom(lines, options);
      assert.deepEqual(await readSessions(log, project, options), whole, `every session, ${ms} ms after the last line`);
      assert.deepEqual(shown(await readSessions(log, project, { ...options, of: "in-view" })), shown(whole), `the sessions the list shows, ${ms} ms after`);
      assert.deepEqual(working(await readSessionStates(log, project, options)), working(whole), `the sessions working, ${ms} ms after`);
      assert.deepEqual(await readClaims(log, project, options), claimsFrom(lines, options), `who holds what, ${ms} ms after`);
    }
    const read = await log.foldLines(project, ["a", "b", "c", "d"], new Date(0).toISOString());
    assert.ok(read.length < lines.length, `the fold read ${read.length} of the log's ${lines.length} lines`);
  });
});

test("4.29 a session last seen on a machine before that machine's recorded start reads gone, not working, to a reader on any machine, its commands no longer run and its claims read free; a session seen since the start, or on another machine, reads as before (regression: nine dead lanes read working after the Mint box rebooted, 2026-10-06)", async () => {
  await withProject(async (log, project) => {
    const write = (line: Record<string, unknown>) => log.append(project, line as NewLine);
    const dead = { session: "dead", harness: "codex", source: "hook", folder: "/w/dead", machine: "mint" } as const;
    const alive = { session: "alive", harness: "claude-code", source: "hook", folder: "/w/alive", machine: "mint" } as const;
    const elsewhere = { session: "elsewhere", harness: "claude-code", source: "hook", folder: "/w/laptop", machine: "laptop" } as const;
    await write({ ...dead, kind: "session-started", how: "startup" });
    await write({ ...dead, source: "tool", kind: "claimed", increment: "inc-dead", reason: "a lane" });
    await write({ ...dead, kind: "prompt-submitted" });
    const lastWords = await write({ ...dead, kind: "command-started", command: "pnpm gate", call: "dead-1" });
    await write({ ...elsewhere, kind: "session-started", how: "startup" });
    await write({ ...elsewhere, source: "tool", kind: "claimed", increment: "inc-laptop", reason: "laptop work" });
    await write({ ...elsewhere, kind: "prompt-submitted" });
    // Mint starts again after the dead lane's last line; the first hook there records it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await write({ ...alive, kind: "machine-started", startedAt: after(lastWords, 10).toISOString() });
    await write({ ...alive, kind: "session-started", how: "startup" });
    await write({ ...alive, source: "tool", kind: "claimed", increment: "inc-alive", reason: "after the restart" });
    const last = await write({ ...alive, kind: "prompt-submitted" });

    const { lines } = await log.since(project, 0);
    const options = { now: after(last, 1_000), quietMs: QUIET_MS, leaveMs: LEAVE_MS };
    const states = (sessions: readonly { session: string; state: string }[]) => Object.fromEntries(sessions.map(({ session, state }) => [session, state]));
    const expected = { dead: "gone", alive: "working", elsewhere: "working" };
    assert.deepEqual(states(sessionsFrom(lines, options)), expected, "a fold of the whole log");
    assert.deepEqual(states(await readSessions(log, project, options)), expected, "the sessions list's bounded read");
    assert.deepEqual(states(await readSessionStates(log, project, options)), expected, "the status line's states");
    assert.deepEqual(sessionsFrom(lines, options).find((one) => one.session === "dead")?.running, [], "its command died with it");
    const holders = (claims: readonly { increment?: string | undefined; holder: string }[]) => Object.fromEntries(claims.map(({ increment, holder }) => [increment, holder]));
    const free = { "inc-dead": "idle", "inc-laptop": "live", "inc-alive": "live" };
    assert.deepEqual(holders(claimsFrom(lines, options)), free, "the noticeboard from the whole log");
    assert.deepEqual(holders(await readClaims(log, project, options)), free, "the noticeboard's bounded read");
  });
});
