import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { actionTable, exitCode, judge, lagHome, summary } from "./desktop-lag.mjs";

test("8.3 pnpm lag:desktop --home starts cold on a new home and warm on one an earlier run left", () => {
  const from = mkdtempSync(path.join(tmpdir(), "lag-home-from-"));
  const home = path.join(mkdtempSync(path.join(tmpdir(), "lag-home-")), "run");
  try {
    writeFileSync(path.join(from, "settings.json"), '{"library":"cloud"}');
    writeFileSync(path.join(from, "auth.json"), '{"postgres":{"key":"synthetic"}}', { mode: 0o600 });
    const cold = lagHome({ home, homeFrom: from });
    assert.deepEqual(cold, { home, warm: false });
    assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), '{"library":"cloud"}');
    // The configured library's Postgres password (the `postgres` key in auth.json) comes too, readable by the user alone.
    const auth = path.join(home, "auth.json");
    assert.equal(readFileSync(auth, "utf8"), '{"postgres":{"key":"synthetic"}}');
    if (process.platform !== "win32") assert.equal(statSync(auth).mode & 0o777, 0o600);
    // The app keeps its reading under the home's electron folder; a run that left one is reused untouched.
    mkdirSync(path.join(home, "electron"));
    writeFileSync(path.join(home, "settings.json"), '{"library":"kept"}');
    assert.deepEqual(lagHome({ home, homeFrom: from }), { home, warm: true });
    assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), '{"library":"kept"}');
  } finally {
    rmSync(from, { recursive: true, force: true });
    rmSync(path.dirname(home), { recursive: true, force: true });
  }
});

test("8.2 pnpm lag:desktop analysis preserves the measured CPU intervals and their function attribution", () => {
  const out = mkdtempSync(path.join(tmpdir(), "lag-profile-"));
  try {
    copyFileSync(new URL("../evidence/lag-allocation/runtime.cpuprofile", import.meta.url), path.join(out, "renderer.cpuprofile"));
    // Only the CPU profile is measured. This envelope supplies the other required analysis fields.
    writeFileSync(path.join(out, "result.json"), JSON.stringify({ state: "CPU-only fixture: desktop metrics unmeasured", readyMs: 0, marks: [], ipc: [], ev: [], loaf: [], lag: [], mem: {} }));
    const report = summary(out);
    const cli = execFileSync(process.execPath, [process.env.npm_execpath, "--silent", "run", "lag:desktop", "--analyze", out], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)), encoding: "utf8", timeout: 30_000,
    });
    assert.equal(cli.trimEnd(), report);
    // The frozen runtime capture has 122322 us total, 13916 us self and 100798 us inclusive.
    assert.match(report, /CPU profile: 122 ms\n/);
    const [self, inclusive] = report.split("Top self:\n")[1].split("\nTop inclusive:\n");
    assert.match(self, /^\s+14 measuredWork \[eval1\]:9$/m);
    assert.match(inclusive, /^\s+101 measuredWork \[eval1\]:9$/m);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("8.4 pnpm lag:desktop judges each named action's recorded rounds against its budget, in one table, and an action it could not perform reads NOT RUN in the table and the exit code", () => {
  const budget = { responseMs: 100, frameMs: 50, settledMs: 1000 };
  const round = (fields) => ({ inputs: 2, response: 40, frames: [], settled: 300, ipc: { "storytree:projectTree": 1 }, ...fields });
  const quick = { name: "open-fewest-island", budget, rounds: [round({}), round({ response: 60, ipc: {} }), round({ response: null })] };
  // Its worst response (60) is within 100; a round under the browser's 16 ms threshold counts as answered at once.
  assert.deepEqual(judge(quick), { name: "open-fewest-island", rounds: 3, response: { median: 40, worst: 60 }, longestFrame: 0,
    settled: { median: 300, worst: 300 }, ipc: 1, verdict: { response: "within", smooth: "within", settled: "within" } });
  // The library's island: one slow answer, a 180 ms frame naming its script, and a settle past 1 s with no progress on show.
  const slow = { name: "open-named-island", budget, rounds: [round({ response: 140, frames: [{ duration: 180, scripts: ["FrameRequestCallback/render"] }], settled: 1400 }), round({})] };
  assert.deepEqual(judge(slow).verdict, { response: "missed", smooth: "missed", settled: "missed" });
  // Past 1 s is within when progress showed within the response budget and stayed until settled; not when it came late or went.
  assert.equal(judge({ ...slow, rounds: [round({ settled: 1400, progressAt: 30, progressHeld: true })] }).verdict.settled, "within");
  assert.equal(judge({ ...slow, rounds: [round({ settled: 1400, progressAt: 300, progressHeld: true })] }).verdict.settled, "missed");
  assert.equal(judge({ ...slow, rounds: [round({ settled: 1400, progressAt: 30, progressHeld: false })] }).verdict.settled, "missed");
  // An action that made no input and has nothing to settle (ten seconds idle) is judged on its frames alone.
  const idle = judge({ name: "idle", budget, rounds: [round({ inputs: 0, response: null, settled: null })] });
  assert.deepEqual([idle.response, idle.settled, idle.verdict], [undefined, undefined, { response: "n/a", smooth: "within", settled: "n/a" }]);
  const missing = { name: "open-library-note", budget, rounds: [], notRun: "a Library note is not in view" };
  assert.deepEqual(judge(missing), { name: "open-library-note", rounds: 0, notRun: "a Library note is not in view" });

  const rows = [quick, slow, missing].map(judge);
  const table = actionTable(rows).split("\n");
  assert.equal(table.length, 4, "a header and a row per action");
  assert.match(table[1], /^open-fewest-island\s+3\s+40 \/ 60 ms\s+none over 50\s+300 \/ 300 ms\s+1\s+within\s+within\s+within$/);
  assert.match(table[2], /^open-named-island\s+2\s+40 \/ 140 ms\s+180 ms\s+300 \/ 1400 ms\s+1\s+missed\s+missed\s+missed$/);
  assert.match(table[3], /^open-library-note\s+0\s+NOT RUN: a Library note is not in view$/);
  assert.equal(exitCode(rows), 3);
  assert.equal(exitCode([quick, slow].map(judge)), 0, "a missed budget is reported, not a failed run");

  // --analyze reprints the table from result.json, which keeps every round.
  const out = mkdtempSync(path.join(tmpdir(), "lag-actions-"));
  try {
    writeFileSync(path.join(out, "result.json"), JSON.stringify({ state: "ready", readyMs: 0, marks: [], actions: [quick, slow, missing], ipc: [], ev: [], loaf: [], lag: [], mem: {} }));
    assert.ok(summary(out).startsWith(`${actionTable(rows)}\n`));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
