/**
 * The log fold (ADR-0836 D1, D4): the sessions and claims a reading shows are an exact fold over the
 * log's lines in order, with the time applied when it is read. A fold fed the log a piece at a time,
 * as the page's live reading hears it, or kept as a snapshot and restored, reads the same as one fed
 * every line at once (sessionsFrom and claimsFrom are that fold).
 * No database: the lines are written out here as the log hands them out.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/library";
import { claimsFrom, LogFold, sessionsFrom } from "./readings.js";

/** A small seeded generator, so the log is the same on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const START = Date.parse("2026-09-01T00:00:00Z");

/**
 * A busy log: several sessions in two harnesses starting, prompting, running commands (some never
 * finished, some finished before their start line, some left in the background), compacting,
 * claiming, releasing, landing, closing out and ending, while others' lines say what merged, what a
 * branch's state is, and what the apps keep.
 */
function busyLog(seed: number, count: number): Line[] {
  const next = random(seed);
  const pick = <T,>(of: readonly T[]): T => of[Math.floor(next() * of.length)]!;
  const sessions = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const branches = ["main", "feat/a", "feat/b", "fix/c"];
  const folders = ["/work", "/work/.wt/a", "/work/.wt/b"];
  const parts = [{ capability: "cap-1" }, { capability: "cap-2" }, { increment: "inc-1" }, { increment: "inc-2" }];
  const calls: string[] = [];
  const lines: Line[] = [];
  let at = START;
  for (let seq = 1; seq <= count; seq++) {
    at += Math.floor(next() * 40 * 60_000);
    const session = pick(sessions);
    const common = {
      session,
      source: next() < 0.8 ? "hook" as const : "tool" as const,
      ...(next() < 0.7 ? { harness: session === "s6" ? "codex" : "claude-code" } : {}),
      ...(next() < 0.6 ? { folder: pick(folders) } : {}),
      ...(next() < 0.6 ? { branch: pick(branches) } : {}),
      ...(next() < 0.5 ? { machine: pick(["mint", "laptop"]) } : {}),
    };
    const roll = next();
    let line: NewLine;
    if (roll < 0.05) line = { ...common, kind: "session-started", ...(next() < 0.5 ? { how: pick(["startup", "compact", "resume"]) } : {}) };
    else if (roll < 0.08) line = { ...common, kind: "session-ended" };
    else if (roll < 0.18) line = { ...common, kind: "prompt-submitted" };
    else if (roll < 0.26) line = { ...common, kind: "turn-ended", ...(next() < 0.3 ? { background: Math.floor(next() * 3) } : {}) };
    else if (roll < 0.38) {
      const call = `call-${seq}`;
      calls.push(call);
      line = { ...common, kind: "command-started", command: `run ${seq}`, call, ...(next() < 0.2 ? { limitMs: 3_600_000 } : {}) };
    } else if (roll < 0.48) {
      // A finish for a command already started, or one whose start line comes later.
      const call = next() < 0.8 && calls.length > 0 ? pick(calls) : `call-${seq + 1}`;
      line = { ...common, kind: "command-run", command: "", ...(next() < 0.9 ? { call } : {}) };
    } else if (roll < 0.53) line = { ...common, kind: "file-edited", files: ["/work/x.ts"] };
    else if (roll < 0.6) line = { ...common, kind: "claimed", ...pick(parts), reason: "doing it" };
    else if (roll < 0.64) line = { ...common, kind: "released", ...pick(parts) };
    else if (roll < 0.66) line = { ...common, kind: "landed", capability: pick(["cap-1", "cap-2"]) };
    else if (roll < 0.68) line = { ...common, kind: "closed", increment: pick(["inc-1", "inc-2"]), disposition: "landed" };
    else if (roll < 0.71) line = { ...common, kind: "merged", ...pick(parts), holder: pick(sessions), branch: pick(branches), pr: seq };
    else if (roll < 0.77) {
      const open = next() < 0.5;
      line = { ...common, session: "app", kind: "branch-state", of: pick(branches), open, how: open ? "ahead" : "merged",
        ...(open && next() < 0.5 ? { pr: seq, checks: pick(["pending", "passing", "failing"] as const), ...(next() < 0.3 ? { draft: true as const } : {}), ...(next() < 0.3 ? { queued: true as const } : {}) } : {}) };
    } else if (roll < 0.8) line = { ...common, session: "app", kind: pick(["session-archived", "session-unarchived"] as const), of: pick(sessions), app: "claude-desktop" };
    else if (roll < 0.83) line = { ...common, session: "app", kind: "session-described", of: pick(sessions), app: "claude-desktop", ...(next() < 0.7 ? { title: `title ${seq}` } : {}), ...(next() < 0.7 ? { status: `status ${seq}` } : {}) };
    else if (roll < 0.87) line = { ...common, kind: "closed-out", safe: next() < 0.7, why: "done", ...(next() < 0.8 ? { running: Math.floor(next() * 2) } : {}) };
    else if (roll < 0.9) line = { ...common, kind: "subagent-started", subagent: `sub-${seq}` };
    else line = { ...common, kind: "note-read", note: "note-1", found: "search", read: "peek" };
    lines.push({ ...line, seq, project: "p", at: new Date(at).toISOString() } as Line);
  }
  return lines;
}

test("a fold fed the log a piece at a time reads the same sessions and claims as the whole history, at every time it is read", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const lines = busyLog(seed, 600);
    const fold = new LogFold();
    let from = 0;
    for (const cut of [1, 2, 7, 30, 50, 51, 90, 140, 200, 260, 330, 433, 500, 599, 600]) {
      fold.add(lines.slice(from, cut));
      from = cut;
      const heard = lines.slice(0, cut);
      const last = Date.parse(heard.at(-1)!.at);
      for (const later of [0, 5 * 60_000, 31 * 60_000, 2 * 3_600_000, 13 * 3_600_000]) {
        const options = { now: new Date(last + later), quietMs: 20 * 60_000, leaveMs: 3_600_000 };
        const at = `seed ${seed}, ${cut} lines, ${later} ms after the last`;
        assert.deepEqual(fold.sessions(options), sessionsFrom(heard, options), `sessions, ${at}`);
        assert.deepEqual(fold.claims(options), claimsFrom(heard, options), `claims, ${at}`);
      }
    }
  }
});

test("a fold kept as a plain snapshot and restored, then fed the rest, reads the same sessions and claims as one fed every line", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const lines = busyLog(seed, 600);
    for (const cut of [1, 50, 299, 600]) {
      const first = new LogFold();
      first.add(lines.slice(0, cut));
      // Kept as the page keeps it: written out and read back, so nothing of the first fold is shared.
      const restored = LogFold.fromSnapshot(JSON.parse(JSON.stringify(first.snapshot())));
      restored.add(lines.slice(cut));
      const last = Date.parse(lines.at(-1)!.at);
      for (const later of [0, 31 * 60_000, 13 * 3_600_000]) {
        const options = { now: new Date(last + later), quietMs: 20 * 60_000, leaveMs: 3_600_000 };
        const at = `seed ${seed}, kept after ${cut} lines, ${later} ms after the last`;
        assert.deepEqual(restored.sessions(options), sessionsFrom(lines, options), `sessions, ${at}`);
        assert.deepEqual(restored.claims(options), claimsFrom(lines, options), `claims, ${at}`);
      }
      const whole = new LogFold();
      whole.add(lines);
      assert.deepEqual(restored.machines(), whole.machines(), `machines, seed ${seed}, kept after ${cut} lines`);
    }
  }
});

test("4.40 · a burst of lines from one session judges only that session again: every other session reads back as the reading it was, and a read with nothing new and no threshold passed reads back the same", () => {
  const lines = busyLog(7, 400);
  const fold = new LogFold();
  fold.add(lines);
  const last = lines.at(-1)!;
  const options = { now: new Date(Date.parse(last.at) + 60_000), quietMs: 20 * 60_000, leaveMs: 3_600_000 };
  const before = fold.sessions(options);
  assert.deepEqual(fold.sessions({ ...options, now: new Date(options.now) }).map((one, i) => one === before[i]), before.map(() => true), "nothing new");
  const busy = before[0]!.session;
  const at = new Date(Date.parse(last.at) + 30_000).toISOString();
  fold.add([1, 2, 3].map((n) => ({ seq: last.seq + n, project: "p", at, session: busy, source: "hook", kind: "file-edited", files: ["/work/y.ts"] }) as Line));
  const after = fold.sessions(options);
  assert.deepEqual(after.map((one, i) => one === before[i]), before.map((one) => one.session !== busy), "only the busy session judged again");
  assert.deepEqual(after, sessionsFrom([...lines, ...[1, 2, 3].map((n) => ({ seq: last.seq + n, project: "p", at, session: busy, source: "hook", kind: "file-edited", files: ["/work/y.ts"] }) as Line)], options));
});

test("4.46 · a fold names the sessions with a line of their own it has never folded, and folds such a session's earlier lines as what they say of it alone: it reads as the whole history reads it, and the claims and branches the fold holds stand", () => {
  const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();
  const line = (seq: number, session: string, kind: string, more: Record<string, unknown> = {}) => ({ seq, project: "p", at: at(seq), session, source: "hook", kind, ...more }) as Line;
  const here = line(2, "here", "session-started", { folder: "/here" });
  const earlier = [line(1, "back", "session-started", { folder: "/back", machine: "mint" }), line(3, "back", "session-named", { title: "Fix the rail" }),
    line(4, "back", "claimed", { capability: "cap-1", reason: "mine" }), line(5, "back", "branch-state", { of: "feat/a", open: true, how: "ahead" })];
  const between = [line(6, "back", "released", { capability: "cap-1" }), line(7, "watch", "branch-state", { of: "feat/a", open: false, how: "merged" }), line(8, "here", "prompt-submitted")];
  // A bounded start of the log: the session in view and the line about feat/a, with the standing claims (none).
  const fold = LogFold.fromBounded([here, between[1]!, between[2]!], []);
  const news = [line(9, "back", "prompt-submitted", { folder: "/back/.wt/x" }), line(10, "watch", "branch-state", { of: "feat/b", open: true, how: "ahead" }), line(11, "pull-request-12", "claimed", { capability: "cap-2", reason: "landing" })];

  assert.deepEqual(fold.strangers(news), ["back"], "a session it never folded, not one that writes only of others, nor a pull request's holder");
  fold.foldEarlier(earlier);
  fold.add(news);
  assert.deepEqual(fold.strangers(news), [], "folded, it is a stranger no more");

  const whole = [...earlier, here, ...between, ...news].sort((a, b) => a.seq - b.seq);
  const options = { now: new Date(Date.parse(at(12))) };
  assert.deepEqual(fold.sessions(options), sessionsFrom(whole, options), "its name, first folder and start, in the order they started");
  assert.deepEqual(fold.claims(options), claimsFrom(whole, options), "its released claim is not taken again");
  assert.deepEqual(fold.machines(), (() => { const all = new LogFold(); all.add(whole); return all.machines(); })(), "and its machine");
  assert.deepEqual(fold.snapshot().branchStates.find(([branch]) => branch === "feat/a")?.[1].open, false, "and a branch's later state stands");
  fold.foldEarlier([line(2, "here", "session-named", { title: "Renamed" })]);
  assert.equal(fold.sessions(options).find(({ session }) => session === "here")?.name, undefined, "a session it already knows is left as it is");
});
