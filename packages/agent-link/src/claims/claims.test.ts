/**
 * Capability 5 · Claims: one test per contract 5.1-5.6 in the agent link story, against the real
 * Postgres `pnpm test` provides. Each test plans a story with two capabilities in a fresh project's
 * library (named with uniqueProjectName(), dropped afterwards), and claims them through the agent
 * activity log, as sessions A (Claude Code) and B (Codex) would.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog, type LockedLog, type NewLine } from "../activity/index.js";
import { readClaim, readClaims } from "../index.js";
import { claimFrom, claimsFrom } from "../readings.js";
import { runHook } from "../hooks/index.js";
import { MARKER_FILE } from "../routing/index.js";
import { claudeCode, withAgent } from "../testing/agent.js";
import { countingStore } from "../testing/egress.js";
import { withTempDir } from "../testing/folders.js";
import { approveCheckout, dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { readSessions } from "../sessions/index.js";
import { claim, claimRefusal, closed, land, readAttribution, release, releaseFor, type ClaimContext, type MergedPull, type MergeWatch } from "./index.js";
import { boardClaims, due, mergedPullsThrough } from "./merges.js";

interface World {
  log: ActivityLog;
  library: Library;
  project: string;
  /** The capability "Email form". */
  emailForm: string;
  /** The capability "Password reset". */
  passwordReset: string;
  /** Session A (Claude Code), or B (Codex), claiming in this project. */
  as(session: "A" | "B", options?: { quietMs?: number; log?: ActivityLog; branch?: string }): ClaimContext;
}

/** Run `body` with a fresh project planned with two capabilities, and the log open on the test server. */
async function withWorld(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor can sign up" });
    const emailForm = (await library.addCapability({ title: "Email form", story: story.id })).id;
    const passwordReset = (await library.addCapability({ title: "Password reset", story: story.id })).id;
    const harnessOf = { A: "claude-code", B: "codex" } as const;
    await body({
      log,
      library,
      project,
      emailForm,
      passwordReset,
      as: (session, options = {}) => ({
        log: options.log ?? log,
        library,
        project,
        session,
        harness: harnessOf[session],
        ...(options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
        ...(options.branch === undefined ? {} : { branch: options.branch }),
      }),
    });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
}

test('5.1 session A claims "email form", and the claim shows A and the reason', async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const answer = await claim(as("A"), emailForm, "building the email form");
    assert.equal(answer.ok, true);
    assert.deepEqual(
      (await readClaims(log, project)).map(({ capability, session, label, reason, holder }) => ({ capability, session, label, reason, holder })),
      [{ capability: emailForm, session: "A", label: "Claude Code", reason: "building the email form", holder: "live" }],
    );
  });
});

test("5.2 B's claim on it is refused, naming A, and a claim-refused line records it; once A has been idle past the quiet time, B's claim succeeds", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const quietMs = 1_000;
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);

    const refused = await claim(as("B", { quietMs }), emailForm, "I want it too");
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && refused.refused === "held");
    assert.deepEqual({ session: refused.holder.session, label: refused.holder.label, reason: refused.holder.reason }, {
      session: "A",
      label: "Claude Code",
      reason: "building the email form",
    });
    const refusals = (await log.since(project, 0)).lines.filter((line) => line.kind === "claim-refused");
    assert.deepEqual(refusals.map((line) => ({ session: line.session, capability: line.capability, holder: line.holder, reason: line.reason })),
      [{ session: "B", capability: emailForm, holder: "A", reason: "I want it too" }], "the refusal is recorded as it happens, naming the holder");

    await sleep(quietMs + 300); // A says nothing for longer than the quiet time
    const takenOver = await claim(as("B", { quietMs }), emailForm, "A went quiet; taking over");
    assert.ok(takenOver.ok);
    assert.equal(takenOver.takenOverFrom?.session, "A");
    assert.deepEqual(
      (await readClaims(log, project, { quietMs })).map(({ capability, session, reason }) => ({ capability, session, reason })),
      [{ capability: emailForm, session: "B", reason: "A went quiet; taking over" }],
      "B holds it now, and A does not",
    );
  });
});

test("5.2, 4.12 verified safe close-out permits takeover despite stale commands; unverified or resumed holders still bind", async () => {
  for (const scenario of ["finished", "compacted", "unsafe", "unknown-runs", "running", "unmerged", "dirty-main", "background", "prompted", "restarted", "new-claim", "reclaimed"] as const) {
    await withWorld(async ({ log, project, emailForm, passwordReset, as }) => {
      const own = { session: "A", harness: "codex", source: "hook", machine: "mint", folder: "/work", branch: "main" } as const;
      const append = (line: NewLine) => log.append(project, line);
      assert.ok((await claim({ ...as("A"), ...own, source: "tool" }, emailForm, "building email form")).ok);
      await append({ ...own, kind: "command-started", call: "lost-finish", command: "pnpm test > results.log" });
      // A branch look can resolve the work without releasing a capability claimed on main.
      await append({ ...own, branch: "fix-login", kind: "file-edited", files: ["a.ts"] });
      if (scenario !== "unmerged") await append({ session: "observer", source: "hook", kind: "branch-state", of: "fix-login", open: false, how: "merged", pr: 3 });
      if (scenario === "dirty-main") {
        await append({ ...own, kind: "file-edited", files: ["a.ts"] });
        await append({ session: "observer", source: "hook", kind: "main-state", machine: "mint", of: "/work", dirty: true });
      }
      await append({ ...own, source: "tool", kind: "closed-out", safe: scenario !== "unsafe", why: "finished",
        ...(scenario === "unknown-runs" ? {} : { running: scenario === "running" ? 1 : 0 }) });
      if (scenario === "background") await append({ ...own, kind: "turn-ended", background: 1 });
      if (scenario === "prompted") await append({ ...own, kind: "prompt-submitted" });
      if (scenario === "restarted" || scenario === "compacted") await append({ ...own, kind: "session-started", how: scenario === "compacted" ? "compact" : "resume" });
      if (scenario === "new-claim" || scenario === "reclaimed") {
        assert.ok((await claim(as("A"), scenario === "new-claim" ? passwordReset : emailForm, "continuing work")).ok);
      }
      const finished = scenario === "finished" || scenario === "compacted";
      const options = { quietMs: 60_000 };
      const session = (await readSessions(log, project, { of: ["A"] }))[0]!;
      assert.equal(session.closeOut?.verified === true, finished, `${scenario}: session listing`);
      assert.equal(session.listing, finished ? "hidden" : "listed", scenario);
      const bounded = await readClaims(log, project, options);
      const whole = claimsFrom((await log.since(project, 0)).lines, options);
      assert.equal(bounded.find((one) => one.capability === emailForm)?.holder, finished ? "idle" : "live", `${scenario}: bounded claims`);
      assert.deepEqual(bounded, whole, `${scenario}: board and bounded reader agree`);
      assert.equal((await claimRefusal(as("B", options), emailForm)) === undefined, finished, `${scenario}: workspace preview`);
      const contender = await claim(as("B", options), emailForm, "next writer");
      assert.equal(contender.ok, finished, `${scenario}: atomic admission`);
      if (contender.ok) assert.equal(contender.takenOverFrom?.session, "A", scenario);
      else {
        assert.ok(contender.refused === "held" && contender.holder.session === "A", scenario);
        assert.ok(contender.holder.binds, scenario);
        if (scenario === "dirty-main") assert.match(contender.holder.binds ?? "", /worked on main/, scenario);
        if (scenario === "unmerged") assert.match(contender.holder.binds ?? "", /fix-login is unmerged/, scenario);
      }
    });
  }
});

test('5.3 when A reports it landed, the claim ends and a "landed" line is written; a release, or A\'s session ending, also ends it', async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    const landed = await land(as("A"), emailForm);
    assert.ok(landed.ok);
    assert.deepEqual({ kind: landed.line.kind, session: landed.line.session }, { kind: "landed", session: "A" });
    assert.ok(landed.line.kind === "landed" && landed.line.capability === emailForm);
    assert.deepEqual(await readClaims(log, project), [], "landing ended the claim");

    assert.equal((await claim(as("A"), emailForm, "one more change")).ok, true);
    assert.deepEqual(await release(as("A"), emailForm), { ok: true });
    assert.deepEqual(await readClaims(log, project), [], "releasing ended it");

    assert.equal((await claim(as("A"), emailForm, "and another")).ok, true);
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "session-ended", reason: "other" });
    assert.deepEqual(await readClaims(log, project), [], "A's session ending ended it");
  });
});

test("5.26 the session manager ends a quiet session's claim with a release naming the holder and why, in every reading; a live holder's claim, or one the named session does not hold, is refused and nothing is written", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const quietMs = 1_000;
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);

    const live = await releaseFor(as("B", { quietMs }), emailForm, "A", "quiet four hours, messaged");
    assert.ok(!live.ok && live.refused === "live" && live.holder?.session === "A", JSON.stringify(live));
    const notHeld = await releaseFor(as("B", { quietMs }), emailForm, "C", "no such holder");
    assert.ok(!notHeld.ok && notHeld.refused === "not-held", JSON.stringify(notHeld));
    assert.deepEqual((await log.since(project, 0)).lines.filter((line) => line.kind === "released"), [], "a refusal writes nothing");

    await sleep(quietMs + 300); // A says nothing for longer than the quiet time
    assert.deepEqual(await releaseFor(as("B", { quietMs }), emailForm, "A", "quiet 24 hours after the manager's message"), { ok: true });
    const [line] = (await log.since(project, 0)).lines.filter((one) => one.kind === "released");
    assert.ok(line?.kind === "released");
    assert.deepEqual({ session: line.session, holder: line.holder, reason: line.reason, capability: line.capability },
      { session: "B", holder: "A", reason: "quiet 24 hours after the manager's message", capability: emailForm });
    assert.deepEqual(await readClaims(log, project, { quietMs }), [], "the bounded reading no longer shows A's claim");
    assert.deepEqual(claimsFrom((await log.since(project, 0)).lines, { quietMs }), [], "nor does the fold of the whole log");
  });
});

test("5.4 a claim on a capability the library doesn't have is refused, and when two agents claim at the same instant exactly one wins", async () => {
  await withWorld(async ({ log, project, library, as }) => {
    const missing = await claim(as("A"), "capability_000000000000", "no such thing");
    assert.deepEqual(missing, { ok: false, refused: "unknown-capability", capability: "capability_000000000000" });
    assert.deepEqual((await log.since(project, 0)).lines, [], "nothing written for it");

    // Each agent through its own connection, both claiming the same capability at once: every time,
    // one wins and the other is refused naming the winner.
    const other = await openActivityLog(testServerUrl());
    try {
      const [story] = (await library.projectTree()).stories;
      for (let round = 1; round <= 5; round++) {
        const contested = (await library.addCapability({ title: `Contested ${round}`, story: story!.id })).id;
        const [a, b] = await Promise.all([claim(as("A"), contested, "mine"), claim(as("B", { log: other }), contested, "no, mine")]);
        assert.equal([a, b].filter((answer) => answer.ok).length, 1, `round ${round}: exactly one wins`);
        const [winner, loser] = a.ok ? ["A", b] : ["B", a];
        assert.ok(!loser.ok && loser.refused === "held" && loser.holder.session === winner, `round ${round}: the other is refused naming ${winner}`);
        assert.deepEqual((await readClaims(log, project)).filter((held) => held.capability === contested).map((held) => held.session), [winner]);
      }
    } finally {
      await other.close();
    }
  });
});

test('5.5 an edit made while A holds "email form" counts toward it, and an edit from a session holding nothing counts as unplanned activity', async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const edit = (session: "A" | "B", file: string) =>
      log.append(project, { session, harness: session === "A" ? "claude-code" : "codex", source: "hook", kind: "file-edited", files: [file] });

    await edit("A", "notes.md"); // before any claim
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    await edit("A", "src/signup.ts");
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "command-run", command: "npm test" });
    await edit("B", "src/other.ts"); // B holds nothing
    assert.equal((await land(as("A"), emailForm)).ok, true);
    await edit("A", "README.md"); // after landing

    assert.deepEqual(
      (await readAttribution(log, project)).map(({ line, capability }) => [line.session, line.kind === "file-edited" ? line.files[0] : line.kind, capability]),
      [
        ["A", "notes.md", undefined],
        ["A", "src/signup.ts", emailForm],
        ["A", "command-run", emailForm],
        ["B", "src/other.ts", undefined],
        ["A", "README.md", undefined],
      ],
    );
  });
});

test("5.6 while a command A started is still running, past the quiet time, B's claim on A's capability is refused naming A", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const quietMs = 1_000;
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "command-started", command: "npm run build", call: "call-1" });

    await sleep(quietMs + 300); // the build runs on, longer than the quiet time, and A writes nothing
    let historyReads = 0;
    const locked = <T>(of: string, work: (locked: LockedLog) => Promise<T>) => log.locked(of, (inside) => work({
      ...inside,
      foldLines: (sessions, since) => { historyReads++; return inside.foldLines(sessions, since); },
    }));
    // The log as it is, but for the lock: each of its other reads still reaches the real log.
    const counted = new Proxy(log, {
      get(target, key) {
        if (key === "locked") return locked;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const refused = await claim(as("B", { quietMs, log: counted }), emailForm, "A went quiet; taking over");
    assert.ok(!refused.ok && refused.refused === "held" && refused.holder.session === "A" && refused.holder.holder === "live");
    assert.equal(historyReads, 1, "the holder's lifecycle is read once while the contender holds the lock");
    assert.deepEqual((await readClaims(log, project, { quietMs })).map(({ session, holder }) => ({ session, holder })), [{ session: "A", holder: "live" }]);
  });
});

test("5.6 a Claude Code command with no finish line keeps its holder live only until Claude Code's own limit on a command (10 minutes, or the limit its line records); past it the holder reads idle (regression: a claim read live for 7 hours, 2026-09-29)", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const quietMs = 5 * 60 * 1000;
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    // The turn is interrupted: Claude Code writes neither the command's finish nor the turn's end.
    const started = await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "command-started", command: "gh pr create", call: "call-1" });
    const at = (ms: number) => new Date(Date.parse(started.at) + ms);
    assert.equal((await readClaims(log, project, { quietMs, now: at(9 * 60 * 1000) }))[0]?.holder, "live", "still within Claude Code's limit");
    assert.equal((await readClaims(log, project, { quietMs, now: at(11 * 60 * 1000) }))[0]?.holder, "idle", "Claude Code has ended the command by now");

    // Where Claude Code's limit is raised, the command's line says so, and the command counts until then.
    const long = await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "command-started", command: "npm run e2e", call: "call-2", limitMs: 30 * 60 * 1000 });
    const later = (ms: number) => new Date(Date.parse(long.at) + ms);
    assert.equal((await readClaims(log, project, { quietMs, now: later(20 * 60 * 1000) }))[0]?.holder, "live");
    assert.equal((await readClaims(log, project, { quietMs, now: later(31 * 60 * 1000) }))[0]?.holder, "idle");
  });
});

test("5.17 a holder last seen on this machine before it restarted is taken over at once; one seen since, or on another machine, stays protected (regression: a resuming lane waited 30 minutes behind its dead predecessor, 2026-10-01)", async () => {
  await withWorld(async ({ log, project, emailForm, passwordReset, as }) => {
    const mint = await openActivityLog(testServerUrl(), { machine: "mint" });
    try {
      assert.equal((await claim(as("A", { log: mint }), emailForm, "building the email form")).ok, true);
      const restarted = { machine: "mint", at: new Date(Date.now() + 1_000) }; // mint started again after A's last line
      const elsewhere = { machine: "laptop", at: restarted.at };
      const before = { machine: "mint", at: new Date(Date.now() - 60_000) }; // mint's last start was before A's claim

      for (const [why, restart] of [["another machine restarted", elsewhere], ["A was seen since the restart", before]] as const) {
        const refused = await claim({ ...as("B"), restarted: restart }, emailForm, "resuming A's work");
        assert.ok(!refused.ok && refused.refused === "held", why);
      }

      assert.equal((await readClaims(log, project, { restarted }))[0]?.holder, "idle", "the board reads A's claim as free");
      const resumed = await claim({ ...as("B"), restarted }, emailForm, "resuming A's work");
      assert.ok(resumed.ok);
      assert.equal(resumed.takenOverFrom?.session, "A");
      assert.deepEqual((await readClaims(log, project)).map(({ session }) => session), ["B"]);

      assert.equal((await claim(as("A", { log: mint }), passwordReset, "a live A on mint")).ok, true);
      assert.ok(!(await claim({ ...as("B"), restarted: before }, passwordReset, "not dead")).ok);
    } finally {
      await mint.close();
    }
  });
});

test("5.10 a claim taken on branch feature/signup ends with a merged line once GitHub shows a pull request from that branch merged after the claim was taken, found at the next tool call or hook line; one merged before the claim, or still open, ends nothing", async () => {
  await withWorld(async ({ log, project, emailForm, passwordReset, as }) => {
    await withTempDir(async (folder) => {
      writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}
`);
      await approveCheckout(folder, project);
      // GitHub, as `gh` would answer: the merged pull requests from each branch.
      const pulls = new Map<string, MergedPull[]>();
      const merges: MergeWatch = { mergedPulls: async (_folder, branch) => pulls.get(branch) ?? [], everyMs: 0 };
      const held = async () => (await readClaims(log, project)).map(({ capability, session }) => [capability, session]);

      pulls.set("feature/signup", [{ number: 6, mergedAt: new Date(Date.now() - 3_600_000).toISOString() }]); // an earlier pull request from the same branch
      assert.equal((await claim(as("A", { branch: "feature/signup" }), emailForm, "building the email form")).ok, true);
      assert.equal((await claim(as("B", { branch: "feature/reset" }), passwordReset, "building the reset")).ok, true); // B's pull request is still open
      await sleep(20);

      await withAgent(folder, { ...claudeCode("C"), merges }, async (agent) => {
        await agent.call("show_plan");
        assert.deepEqual(await held(), [[emailForm, "A"], [passwordReset, "B"]], "a merge from before the claim, and an open pull request, end nothing");

        pulls.set("feature/signup", [...pulls.get("feature/signup")!, { number: 7, mergedAt: new Date().toISOString() }]);
        await agent.call("show_plan");
      });
      assert.deepEqual(await held(), [[passwordReset, "B"]], "the merge ended A's claim, at the next tool call");
      const merged = (await log.since(project, 0)).lines.filter((line) => line.kind === "merged");
      assert.deepEqual(
        merged.map((line) => line.kind === "merged" && { capability: line.capability, holder: line.holder, branch: line.branch, pr: line.pr, session: line.session }),
        [{ capability: emailForm, holder: "A", branch: "feature/signup", pr: 7, session: "C" }],
      );

      pulls.set("feature/reset", [{ number: 8, mergedAt: new Date().toISOString() }]);
      const edit = JSON.parse(readFileSync(new URL("../hooks/fixtures/claude-code/post-tool-use-write.json", import.meta.url), "utf8")) as Record<string, unknown>;
      await runHook({ argv: ["claude-code"], input: JSON.stringify({ ...edit, cwd: folder, session_id: "D" }), merges, locate: { dataDir: testServerDataDir() } });
      assert.deepEqual(await held(), [], "the merge ended B's claim, at the next hook line");
    });
  });
});

test("5.10 the board asks GitHub itself before it shows claims, even in a minute a hook has already asked: a claim whose branch merged is not shown (regression: a merged branch's claim stood for 7 hours, 2026-09-29)", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    assert.equal((await claim(as("A", { branch: "feature/signup" }), emailForm, "building the email form")).ok, true);
    let locks = 0;
    const counted = new Proxy(log, {
      get(target, key) {
        if (key === "locked") return (of: string, work: (locked: LockedLog) => Promise<unknown>) => { locks++; return log.locked(of, work); };
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const context = { log: counted, project, folder: "/work/site", session: "person:owner", source: "tool" as const };
    const unmerged = await boardClaims(context, { mergedPulls: async () => [] });
    assert.deepEqual(unmerged.map((claim) => claim.session), ["A"]);
    assert.equal(locks, 0, "with no merge to reconcile, displaying claims does not queue behind writers (concurrent scan waits, 2026-10-02)");
    await sleep(20);
    const merges: MergeWatch = { mergedPulls: async (_folder, branch) => (branch === "feature/signup" ? [{ number: 7, mergedAt: new Date().toISOString() }] : []) };
    due(project, 60_000); // a hook asked moments ago, and saw no merge then
    const shown = await boardClaims(context, merges);
    assert.deepEqual(shown, [], "the merge ended the claim");
    assert.equal(locks, 1, "a merge still rechecks the current holder under the project lock");
    assert.deepEqual(await readClaims(log, project), [], "and a merged line says so for every reader");
  });
});

test("5.10 asking gh for merged pull requests answers when gh exits, even while a process it started still holds its output (regression: gh's tzutil, 2026-09-28)", { timeout: 30_000 }, async (t) => {
  await withTempDir(async (folder) => {
    // The descendant holds output until this test stops it: its lifetime proves the ordering,
    // independently of how long a busy runner takes to start gh (queue run 37328670634).
    const gh = path.join(folder, "gh.mjs");
    const pidFile = path.join(folder, "descendant.pid");
    const merged = [{ number: 9, mergedAt: "2026-09-28T00:00:00Z" }];
    // Detached, as Node would otherwise end it with gh on Windows; in the temporary folder, so it holds no folder the test removes.
    writeFileSync(gh, `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "inherit", detached: true, cwd: tmpdir() });
writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
process.stdout.write(${JSON.stringify(JSON.stringify(merged))}, () => process.exit(0));
`);

    const started = Date.now();
    try {
      const result = await mergedPullsThrough(process.execPath, [gh])(folder, "feature/signup & more");
      const elapsed = Date.now() - started;
      t.diagnostic(`gh merge query returned in ${elapsed} ms`);
      assert.deepEqual(result, merged, `gh must return its merged result while output is held (query took ${elapsed} ms)`);
      const pid = Number(readFileSync(pidFile, "utf8"));
      assert.doesNotThrow(() => process.kill(pid, 0), "the descendant still holds gh's output when the answer arrives");
    } finally {
      try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch { /* gh may have failed before spawning. */ }
    }
  });
});

/** An arc of work in `library`, and a way to park increments on it, each touching what it names. */
async function arcOf(library: Library, title = "Launch sign-up") {
  const [story] = (await library.projectTree()).stories;
  const arc = await library.createArc({ title, intent: "Ship sign-up", endState: "Visitors sign up", stories: [story!.id] });
  return {
    arc: arc.id,
    park: async (name: string, touches: string[] = []) =>
      (await library.addIncrement({ arc: arc.id, title: name, objective: `Build ${name}`, body: `${name}, red then green`, touches })).id,
  };
}

/** Where increment `id` is in its lifecycle, as the library reads it. */
async function statusOf(library: Library, arc: string, id: string): Promise<string | undefined> {
  return (await library.arcView(arc))?.increments.find((increment) => increment.id === id)?.fields.status;
}

test("5.11 the public readings list current capability and increment claims and find the holder of one unit", async () => {
  await withWorld(async ({ log, project, library, emailForm, as }) => {
    const { park } = await arcOf(library);
    const increment = await park("email form", [emailForm]);
    await claim(as("A"), emailForm, "building the form");
    await claim(as("B"), increment, "driving the increment");
    const { lines } = await log.since(project, 0);
    const options = { now: new Date(Date.parse(lines.at(-1)!.at) + 31 * 60_000) };
    const claims = await readClaims(log, project, options);
    assert.deepEqual(claims, claimsFrom(lines, options), "terminal and board share the reading");
    assert.deepEqual(claims.map(({ capability, increment, session, harness, label, reason, holder }) =>
      [capability ?? increment, session, harness, label, reason, holder]), [
      [emailForm, "A", "claude-code", "Claude Code", "building the form", "idle"],
      [increment, "B", "codex", "Codex", "driving the increment", "idle"],
    ]);
    for (const id of [emailForm, increment]) {
      assert.deepEqual(await readClaim(log, project, id, options), claims.find((held) => (held.capability ?? held.increment) === id));
      assert.deepEqual(claimFrom(lines, id, options), await readClaim(log, project, id, options));
    }
    assert.equal((await readClaim(log, project, increment))?.holder, "live");
    await release(as("B"), increment);
    assert.equal(await readClaim(log, project, increment), undefined, "released work has no holder");
    assert.equal(await readClaim(log, `${project}-other`, emailForm), undefined, "another project has no holder");
  });
});

test("5.27 closing an increment ends the closing session's capability claims taken while it held that increment, in every reading; one it held before, and another session's, stand (ADR-0944 D5)", async () => {
  await withWorld(async ({ log, project, library, emailForm, passwordReset, as }) => {
    const { park } = await arcOf(library);
    const increment = await park("email form");
    assert.equal((await claim(as("A"), passwordReset, "fixing the reset link")).ok, true);
    assert.equal((await claim(as("A"), increment, "driving the email form")).ok, true);
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    await closed(as("A"), increment, "landed");
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "file-edited", files: ["src/reset.ts"] });

    const { lines } = await log.since(project, 0);
    const claims = await readClaims(log, project);
    assert.deepEqual(claims.map(({ capability, increment: on, session }) => [capability ?? on, session]), [[passwordReset, "A"]]);
    assert.deepEqual(claimsFrom(lines), claims, "the whole log and the standing claims agree");
    assert.equal((await readAttribution(log, project)).at(-1)?.capability, passwordReset, "edits after the close count toward what A still holds");

    const other = await park("welcome email");
    assert.equal((await claim(as("B"), other, "driving the welcome email")).ok, true);
    assert.equal((await claim(as("B"), emailForm, "building the email form")).ok, true, "the closed increment's capability is free");
    await closed(as("A"), other, "withdrawn");
    assert.equal((await readClaim(log, project, emailForm))?.session, "B", "another session's close ends only the increment's own claim");
  });
});

test("5.7 session A claims a proposed increment, which the claim shows while the library shows it active, and B's claim on it is refused naming A; a ready one starts the same way, an active one is not started again, and a closed one is refused", async () => {
  await withWorld(async ({ log, project, library, as }) => {
    const { arc, park } = await arcOf(library);
    const proposed = await park("email form");
    const answer = await claim(as("A"), proposed, "driving the email form");
    assert.equal(answer.ok, true);
    assert.deepEqual(
      (await readClaims(log, project)).map(({ increment, session, label, reason, holder }) => ({ increment, session, label, reason, holder })),
      [{ increment: proposed, session: "A", label: "Claude Code", reason: "driving the email form", holder: "live" }],
    );
    assert.equal(await statusOf(library, arc, proposed), "active", "claiming it started it");

    const refused = await claim(as("B"), proposed, "I want it too");
    assert.ok(!refused.ok && refused.refused === "held" && refused.holder.session === "A");

    const active = await park("welcome email");
    await library.advanceIncrement(active, "active");
    assert.equal((await claim(as("B"), active, "picking it up")).ok, true, "an active one is claimed, not started again");
    assert.equal(await statusOf(library, arc, active), "active");

    const closed = await park("old form");
    await library.closeIncrement(closed, { pr: "#3", disposition: "landed" });
    const lines = (await log.since(project, 0)).lines.length;
    assert.deepEqual(await claim(as("A"), closed, "one more go"), { ok: false, refused: "closed", increment: closed });
    assert.equal((await log.since(project, 0)).lines.length, lines, "nothing written for it");
  });
});

test("5.8 claiming an increment whose own wait holds, or whose arc's wait holds, is refused naming each blocker and its reason, and one held on an open question is refused as waiting on the owner; nothing is written and it is not started; once the wait releases the claim succeeds", async () => {
  await withWorld(async ({ log, project, library, as }) => {
    const { arc, park } = await arcOf(library);
    const form = await park("email form");
    const confirm = await park("confirmation email");
    await library.addWait(confirm, form, "it sends what the form collects");

    const lines = (await log.since(project, 0)).lines.length;
    assert.deepEqual(await claim(as("A"), confirm, "driving it"), {
      ok: false,
      refused: "waiting",
      waits: [{ increment: confirm, on: form, reason: "it sends what the form collects", forGood: false }],
    });
    assert.equal((await log.since(project, 0)).lines.length, lines, "nothing written");
    assert.equal(await statusOf(library, arc, confirm), "proposal", "not started");

    const later = await arcOf(library, "Launch v2");
    const polish = await later.park("polish");
    await library.addWait(later.arc, arc, "v2 follows v1");
    const refused = await claim(as("A"), polish, "driving it");
    assert.ok(!refused.ok && refused.refused === "waiting");
    assert.deepEqual(refused.waits, [{ increment: polish, on: arc, reason: "v2 follows v1", forGood: false }], "its arc's wait holds it");

    await library.closeIncrement(form, { pr: "#4", disposition: "landed" });
    assert.equal((await claim(as("A"), confirm, "driving it")).ok, true, "the form landed, so the wait released");
    assert.equal(await statusOf(library, arc, confirm), "active");

    const welcome = await park("welcome email");
    const question = await library.raiseQuestion({ arc, title: "Which mailer?", stakes: "Cost", statement: "Mailgun or SES?", context: "Both work", options: "Mailgun; SES" });
    await library.editIncrement(welcome, { heldOn: [question.id] });
    const onOwner = await claim(as("B"), welcome, "driving it");
    assert.ok(!onOwner.ok && onOwner.refused === "waiting");
    assert.deepEqual(
      onOwner.waits.map(({ increment, on, onOwner: his }) => ({ increment, on, his })),
      [{ increment: welcome, on: question.id, his: true }],
      "held on his open question, it waits on the owner",
    );
    assert.equal(await statusOf(library, arc, welcome), "proposal", "not started");
    await library.settleQuestion(question.id, { answer: "Mailgun" });
    assert.equal((await claim(as("B"), welcome, "driving it")).ok, true, "his answer released it");
  });
});

test("5.9 a capability claim is never refused because the open increments naming it in their touches wait: touches is a plan, never a lock (ADR-0944 D2)", async () => {
  await withWorld(async ({ library, emailForm, as }) => {
    const { park } = await arcOf(library);
    const design = await park("design");
    const first = await park("form, first cut", [emailForm]);
    const second = await park("form, second cut", [emailForm]);
    await library.addWait(first, design, "the design comes first");
    await library.addWait(second, design, "the design comes first");

    assert.equal((await claim(as("A"), emailForm, "building the form")).ok, true, "every increment naming it waits, and the claim stands");
    const refused = await claim(as("B"), first, "driving the first cut");
    assert.ok(!refused.ok && refused.refused === "waiting", "the waiting increment itself is still refused");
  });
});

test("5.16 a reason longer than 40 characters is refused naming the limit and its length, with nothing written or started; 40 characters is claimed", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const long = "Build the email form and its validation!!";
    assert.equal(long.length, 41);
    assert.deepEqual(await claim(as("A"), emailForm, long), { ok: false, refused: "reason-too-long", limit: 40, length: 41 });
    assert.deepEqual(await readClaims(log, project), []);
    assert.equal((await claim(as("A"), emailForm, long.slice(0, 40))).ok, true);
  });
});

for (const target of ["capability", "active increment"] as const) {
  test(`5.15 cancelling a claim queued for the activity lock leaves no claim (${target})`, async () => {
    await withWorld(async ({ library, log, project, emailForm, as }) => {
      let id = emailForm;
      if (target === "active increment") {
        const arc = await library.createArc({ title: "Signup", intent: "Build signup", endState: "Signup works" });
        id = (await library.addIncrement({ arc: arc.id, title: "Form", objective: "Build form", body: "Red then green" })).id;
        await library.advanceIncrement(id, "active");
      }
      const before = await library.get(id);
      const history = await library.history({ id });
      let acquired!: () => void;
      let unblock!: () => void;
      let requested!: () => void;
      const locked = new Promise<void>((resolve) => { acquired = resolve; });
      const hold = new Promise<void>((resolve) => { unblock = resolve; });
      const queued = new Promise<void>((resolve) => { requested = resolve; });
      const blocker = log.locked(project, async () => { acquired(); await hold; });
      await locked;
      const abort = new AbortController();
      const observing = new Proxy(log, {
        get(target, key) {
          if (key === "locked") {
            return (of: string, work: (locked: LockedLog) => Promise<unknown>) => {
              const pending = log.locked(of, work);
              requested();
              return pending;
            };
          }
          const value = Reflect.get(target, key) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const context = { ...as("A", { log: observing }), writer: { signal: abort.signal } };
      const pending = claim(context, id, "Build form");
      const cancelled = assert.rejects(pending, /cancel claim/);
      try {
        await queued;
        abort.abort(new Error("cancel claim"));
      } finally {
        unblock();
        await blocker;
      }
      await cancelled; // The entire claim has settled before inspecting its effects.
      assert.deepEqual(await library.get(id), before);
      assert.deepEqual(await library.history({ id }), history);
      assert.deepEqual((await log.since(project, 0)).lines, []);
    });
  });
}

test("5.7 claiming an increment reads every arc in one ask, however many arcs the project has (ADR-0836 D3)", async () => {
  await withWorld(async ({ library, as }) => {
    await arcOf(library, "First");
    await arcOf(library, "Second");
    const proposed = await (await arcOf(library, "Third")).park("email form");
    const asked = { arcView: 0, arcViews: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (key === "arcView" || key === "arcViews") asked[key]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    assert.equal((await claim({ ...as("A"), library: counted }, proposed, "driving the email form")).ok, true);
    assert.equal(asked.arcView, 0, "never an arc view per arc");
    assert.ok(asked.arcViews <= 1, `every arc in one ask at most: ${asked.arcViews}`);
  });
});

test("5.23 a claim takes from the library what deciding it needs and no more: one the session already holds takes almost nothing, and a capability claim takes about as much with five open increments naming it as with one", { timeout: 180_000 }, async () => {
  const taken = new Map<string, number>();
  for (const naming of [1, 5]) {
    const project = uniqueProjectName();
    const store = await countingStore();
    const counted = new URL(testServerUrl());
    counted.hostname = "127.0.0.1";
    counted.port = String(store.port);
    const storytree = await connect({ url: counted.href });
    const log = await openActivityLog(counted.href);
    try {
      const library = await storytree.openProject(project);
      const story = await library.addStory({ title: "Visitor can sign up" });
      const emailForm = (await library.addCapability({ title: "Email form", story: story.id })).id;
      const arc = (await library.createArc({ title: "Signup", intent: "Build signup", endState: "Signup works" })).id;
      // Weeks of closed work, as a project's increment log grows.
      for (let n = 0; n < 150; n++) {
        await library.addIncrement({ arc, title: `Done ${n}`, objective: "Done", body: "x".repeat(3000), outcome: { disposition: "landed", pr: `#${n}` } });
      }
      // Open increments naming the capability, all but the last waiting: a capability claim reads none of them (ADR-0944 D2).
      const schema = await library.addIncrement({ arc, title: "Schema", objective: "Tables", body: "…" });
      for (let n = 0; n < naming; n++) {
        const part = await library.addIncrement({ arc, title: `Part ${n}`, objective: "A part", body: "…", touches: [emailForm] });
        if (n < naming - 1) await library.addWait(part.id, schema.id, "needs the tables");
      }
      const context: ClaimContext = { log, library, project, session: "A", harness: "claude-code" };
      let before = store.received();
      assert.equal((await claim(context, emailForm, "building the email form")).ok, true);
      taken.set(`first, ${naming} naming it`, store.received() - before);
      before = store.received();
      const again = await claim(context, emailForm, "building the email form");
      assert.equal(again.ok && again.alreadyHeld, true);
      taken.set(`again, ${naming} naming it`, store.received() - before);
    } finally {
      try {
        await log.close();
        await storytree.close();
        await store.close();
      } finally {
        await dropTestProjects([project]);
      }
    }
  }
  const report = JSON.stringify(Object.fromEntries(taken));
  assert.ok(taken.get("again, 5 naming it")! < 32 * 1024, `a claim already held takes almost nothing: ${report}`);
  assert.ok(taken.get("first, 5 naming it")! - taken.get("first, 1 naming it")! < 128 * 1024, `five open increments naming it take about as much as one: ${report}`);
});
