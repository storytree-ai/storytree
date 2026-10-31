import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";
import { CATALOGUE } from "@storytree/forest/actions";

import { actionTable, alternate, closeApp, compareAction, compareTable, exitCode, judge, lagHome, NotRun, performRound, seededHome, startMeasuring, summary, withAgainst } from "./desktop-lag.mjs";

test("8.3 pnpm lag:desktop --home starts cold on a new home and warm on one an earlier run left", async () => {
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
    await removeTemp(from);
    await removeTemp(path.dirname(home));
  }
});

test("8.2 pnpm lag:desktop analysis preserves the measured CPU intervals and their function attribution", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "lag-profile-"));
  try {
    copyFileSync(new URL("./testing/runtime.cpuprofile", import.meta.url), path.join(out, "renderer.cpuprofile"));
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
    await removeTemp(out);
  }
});

test("8.4 pnpm lag:desktop judges each named action's recorded rounds against its budget, in one table, and an action it could not perform reads NOT RUN in the table and the exit code", async () => {
  const budget = { responseMs: 100, frameMs: 50, settledMs: 1000 };
  const round = (fields) => ({ inputs: 2, response: 40, frames: [], settled: 300, ipc: { "storytree:projectTree": 1 }, ...fields });
  const quick = { name: "open-fewest-island", size: "standard", budget, rounds: [round({}), round({ response: 60, ipc: {} }), round({ response: null })] };
  // Its worst response (60) is within 100; a round under the browser's 16 ms threshold counts as answered at once.
  assert.deepEqual(judge(quick), { name: "open-fewest-island", size: "standard", rounds: 3, response: { median: 40, worst: 60 }, longestFrame: 0,
    settled: { median: 300, worst: 300 }, ipc: 1, verdict: { response: "within", smooth: "within", settled: "within" } });
  // The library's island: one slow answer, a 180 ms frame naming its script, and a settle past 1 s with no progress on show.
  const slow = { name: "open-named-island", size: "large", budget, rounds: [round({ response: 140, frames: [{ duration: 180, scripts: ["FrameRequestCallback/render"] }], settled: 1400 }), round({})] };
  assert.deepEqual(judge(slow).verdict, { response: "missed", smooth: "missed", settled: "missed" });
  // Past 1 s is within when progress showed within the response budget and stayed until settled; not when it came late or went.
  assert.equal(judge({ ...slow, rounds: [round({ settled: 1400, progressAt: 30, progressHeld: true })] }).verdict.settled, "within");
  assert.equal(judge({ ...slow, rounds: [round({ settled: 1400, progressAt: 300, progressHeld: true })] }).verdict.settled, "missed");
  assert.equal(judge({ ...slow, rounds: [round({ settled: 1400, progressAt: 30, progressHeld: false })] }).verdict.settled, "missed");
  // An action that made no input and has nothing to settle (ten seconds idle) is judged on its frames alone.
  const idle = judge({ name: "idle", budget, rounds: [round({ inputs: 0, response: null, settled: null })] });
  assert.deepEqual([idle.response, idle.settled, idle.verdict], [undefined, undefined, { response: "n/a", smooth: "within", settled: "n/a" }]);
  const missing = { name: "open-library-note", size: "large", budget, rounds: [], notRun: "a Library note is not in view" };
  assert.deepEqual(judge(missing), { name: "open-library-note", size: "large", rounds: 0, notRun: "a Library note is not in view" });

  const rows = [quick, slow, missing].map(judge);
  const table = actionTable(rows).split("\n");
  assert.equal(table.length, 4, "a header and a row per action");
  assert.match(table[0], /^action\s+size\s+rounds\s/);
  assert.match(table[1], /^open-fewest-island\s+standard\s+3\s+40 \/ 60 ms\s+none over 50\s+300 \/ 300 ms\s+1\s+within\s+within\s+within$/);
  assert.match(table[2], /^open-named-island\s+large\s+2\s+40 \/ 140 ms\s+180 ms\s+300 \/ 1400 ms\s+1\s+missed\s+missed\s+missed$/);
  assert.match(table[3], /^open-library-note\s+large\s+0\s+NOT RUN: a Library note is not in view$/);
  assert.equal(exitCode(rows), 3);
  assert.equal(exitCode([quick, slow].map(judge)), 0, "a missed budget is reported, not a failed run");

  // --analyze reprints the table from result.json, which keeps every round.
  const out = mkdtempSync(path.join(tmpdir(), "lag-actions-"));
  try {
    writeFileSync(path.join(out, "result.json"), JSON.stringify({ state: "ready", readyMs: 0, marks: [], actions: [quick, slow, missing], ipc: [], ev: [], loaf: [], lag: [], mem: {} }));
    assert.ok(summary(out).startsWith(`${actionTable(rows)}\n`));
  } finally {
    await removeTemp(out);
  }
});

test("8.6 pnpm lag:desktop starts the app on a home naming the seeded library, its password readable by the user alone, and prints one table across the sizes it ran", async () => {
  const home = seededHome("postgres://storytree:s%40cret@127.0.0.1:54321/postgres");
  const out = mkdtempSync(path.join(tmpdir(), "lag-sizes-"));
  try {
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")), { library: { location: "postgres", address: "postgres://storytree@127.0.0.1:54321/postgres" } });
    const auth = path.join(home, "auth.json");
    assert.deepEqual(JSON.parse(readFileSync(auth, "utf8")), { postgres: { key: "s@cret" } });
    if (process.platform !== "win32") assert.equal(statSync(auth).mode & 0o777, 0o600);

    // A seeded run keeps each size's run in its own folder; the summary leads with one table across them.
    const budget = { responseMs: 100, frameMs: 50, settledMs: 1000 };
    const round = (settled) => ({ inputs: 1, response: 40, frames: [], settled, ipc: { projectTree: 1 } });
    for (const [size, settled] of [["standard", 300], ["large", 1400]]) {
      mkdirSync(path.join(out, size));
      writeFileSync(path.join(out, size, "result.json"), JSON.stringify({ state: "ready", readyMs: 0, size, marks: [], actions: [{ name: "open-named-island", size, budget, rounds: [round(settled)] }], ipc: [], ev: [], loaf: [], lag: [], mem: {} }));
    }
    const table = summary(out).split("\n\n")[0].split("\n");
    assert.equal(table.length, 3, "a header and a row per size");
    assert.match(table[1], /^open-named-island\s+standard\s+1\s.*300 \/ 300 ms.*within$/);
    assert.match(table[2], /^open-named-island\s+large\s+1\s.*1400 \/ 1400 ms.*missed$/);
  } finally {
    await removeTemp(home);
    await removeTemp(out);
  }
});

test("8.7 pnpm lag:desktop --against judges each action slower, the same or faster on both builds' medians, and prints a count that differs as its own finding", () => {
  const budget = { responseMs: 100, frameMs: 50, settledMs: 1000 };
  const round = (settled, ipc = { "storytree:projectTree": 1 }) => ({ inputs: 1, response: 40, frames: [], settled, ipc });
  const rounds = (values, ipc) => values.map((settled) => round(settled, ipc));
  const action = (name, values, ipc) => ({ name, size: "large", budget, rounds: rounds(values, ipc) });
  // Opening the largest island at 420 ms, measured under uneven load: one round of each build caught the box busy.
  const against = action("open-most-island", [412, 431, 1290, 405, 420]);
  // The same build again, its own busy round elsewhere: the medians agree within the margin.
  assert.deepEqual(compareAction(action("open-most-island", [425, 980, 418, 433, 409]), against),
    { name: "open-most-island", size: "large", rounds: 5, measure: "settled", against: 420, this: 425, difference: 5, verdict: "same", counts: [] });
  // 100 ms of main-thread work more per round: past 20% and past a frame, so slower.
  assert.equal(compareAction(action("open-most-island", [512, 531, 1390, 505, 520]), against).verdict, "slower");
  assert.equal(compareAction(against, action("open-most-island", [512, 531, 1390, 505, 520])).verdict, "faster");
  // Short actions a frame or two apart on every round (settled is read once a frame) are the same, though 160% and 70% worse;
  // 400 ms to 460 ms is past three frames but under 20%, so the same too; 36 ms to 135 ms is past both, so slower.
  assert.equal(compareAction(action("open-library-note", [31, 30, 120, 28, 32]), action("open-library-note", [12, 10, 123, 27, 11])).verdict, "same");
  assert.equal(compareAction(action("library-and-back", [74, 75, 73]), action("library-and-back", [43, 44, 42])).verdict, "same");
  assert.equal(compareAction(action("close-panel", [460, 462, 458]), action("close-panel", [400, 401, 399])).verdict, "same");
  assert.equal(compareAction(action("close-panel", [135, 136, 134]), action("close-panel", [36, 35, 37])).verdict, "slower");
  // An action with nothing to settle is compared on its response; one with no input either, on its frames over 50 ms.
  const hover = (response) => ({ name: "hover-sweep", budget, rounds: [{ inputs: 9, response, frames: [], settled: null, ipc: {} }] });
  assert.deepEqual([compareAction(hover(90), hover(30)).measure, compareAction(hover(90), hover(30)).verdict], ["response", "slower"]);
  const idle = (duration) => ({ name: "idle", budget, rounds: [{ inputs: 0, response: null, frames: [{ duration, scripts: [] }], settled: null, ipc: {} }] });
  assert.deepEqual([compareAction(idle(60), idle(160)).measure, compareAction(idle(60), idle(160)).verdict], ["frames", "faster"]);

  // A read the action asks for more often is a finding of its own, whatever the times say; the page's background poll is not.
  const more = action("open-named-island", [300, 301, 299], { "storytree:projectTree": 1, "storytree:arcViews": 3, "storytree:changesSince": 2, "storytree:projectSelection": 1 });
  const fewer = action("open-named-island", [300, 302, 298], { "storytree:projectTree": 1, "storytree:arcViews": 1, "storytree:linesSince": 1 });
  assert.deepEqual(compareAction(more, fewer).counts, [{ channel: "arcViews", against: 1, this: 3 }]);
  // A side that could not perform the action makes its row NOT RUN, saying which build.
  assert.deepEqual(compareAction({ ...fewer, rounds: [], notRun: "no island \"x\" on the globe" }, fewer), { name: "open-named-island", size: "large", rounds: 0, notRun: "this build: no island \"x\" on the globe" });

  const rows = [compareAction(more, fewer), compareAction(action("open-most-island", [512, 531, 1390, 505, 520]), against)];
  const table = compareTable(rows).split("\n");
  assert.match(table[0], /^action\s+size\s+rounds\s+measure\s+against p50\s+this p50\s+difference\s+verdict$/);
  assert.match(table[1], /^open-named-island\s+large\s+3\s+settled\s+300 ms\s+300 ms\s+\+0 ms \(\+0%\)\s+same$/);
  assert.match(table[2], /^open-most-island\s+large\s+5\s+settled\s+420 ms\s+520 ms\s+\+100 ms \(\+24%\)\s+slower$/);
  assert.match(table.at(-1), /^count: open-named-island \(large\) arcViews 1 -> 3 per round$/);
});

test("8.8 pnpm lag:desktop --against performs each action's rounds on the two builds in turn, A, B, A, B, and one build's NOT RUN ends the action on both", async () => {
  const order = [];
  const side = (label, failOn) => ({
    mark: async () => {},
    perform: async (action) => {
      order.push(`${label}:${action.name}`);
      if (action.name === failOn) throw new NotRun(`${label} cannot`);
      return { label };
    },
  });
  const actions = [{ name: "one", budget: {} }, { name: "two", budget: {} }];
  const [ours, theirs] = await alternate(actions, 3, [side("A", undefined), side("B", "two")], { deadlineMs: () => 10_000 });
  assert.deepEqual(order, ["A:one", "B:one", "A:one", "B:one", "A:one", "B:one", "A:two", "B:two"]);
  assert.deepEqual(ours.map((done) => [done.name, done.rounds.length, done.notRun]), [["one", 3, undefined], ["two", 1, undefined]]);
  assert.deepEqual(theirs.map((done) => [done.name, done.rounds.length, done.notRun]), [["one", 3, undefined], ["two", 0, "B cannot"]]);
});

test("8.9 pnpm lag:desktop --against <ref> measures that ref in a throwaway worktree it installs and removes afterwards; --against <dir> uses the built app there", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "lag-ref-repo-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    mkdirSync(path.join(repo, "apps", "desktop"), { recursive: true });
    writeFileSync(path.join(repo, "apps", "desktop", "marker"), "first");
    git("add", ".");
    git("-c", "user.name=lag", "-c", "user.email=lag@example.invalid", "commit", "-q", "-m", "first");
    const first = git("rev-parse", "HEAD");
    writeFileSync(path.join(repo, "apps", "desktop", "marker"), "second");
    git("-c", "user.name=lag", "-c", "user.email=lag@example.invalid", "commit", "-q", "-am", "second");

    const installed = [];
    const seen = await withAgainst(first, { root: repo, install: (tree) => (installed.push(tree), { ok: true }) }, async (appDir) => {
      assert.equal(readFileSync(path.join(appDir, "marker"), "utf8"), "first", "the ref's own files");
      assert.deepEqual(installed, [path.resolve(appDir, "..", "..")], "installed with the repo's provisioning before use");
      return appDir;
    });
    assert.equal(existsSync(seen), false, "the throwaway worktree is removed afterwards");
    assert.doesNotMatch(git("worktree", "list"), /lag-against/);
    // A failed install still removes the worktree, and says so.
    await assert.rejects(withAgainst(first, { root: repo, install: () => ({ ok: false, code: 1 }) }, async () => {}), /could not install/);
    assert.doesNotMatch(git("worktree", "list"), /lag-against/);

    // A built app folder is used where it is, nothing made or removed.
    const dir = path.join(repo, "apps", "desktop");
    assert.equal(await withAgainst(dir, { root: repo, install: () => assert.fail("no install for a folder") }, async (appDir) => appDir), dir);
    assert.equal(existsSync(dir), true);
  } finally {
    await removeTemp(repo);
  }
});

test("8.10 pnpm lag:desktop queues the whole run behind the machine's heavy-run lock", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "lag-lock-home-"));
  // A live holder: this test's own process.
  writeFileSync(path.join(home, "heavy-run.lock"), JSON.stringify({ id: "held-by-test", pid: process.pid, branch: "a-test-run", since: new Date().toISOString() }));
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./desktop-lag.mjs", import.meta.url)), "--chromium", "--sizes", "standard", "--against", home],
    { env: { ...process.env, STORYTREE_HOME: home, STORYTREE_HEAVY_LOCK_HOLDER: "" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    let output = "";
    await new Promise((resolve, reject) => {
      const read = (data) => {
        output += data;
        if (/heavy-run lock: waiting for a-test-run/.test(output)) resolve();
        if (/seed|lag-against/.test(output)) reject(new Error(`measured before taking the lock:\n${output}`));
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("exit", (code) => reject(new Error(`exited ${code} without waiting:\n${output}`)));
    });
  } finally {
    child.kill("SIGKILL");
    await removeTemp(home);
  }
});

test("8.17 pnpm lag:desktop performs a start action as a real start of the page, the kept keys it names forgotten first, timed from the start's navigation with its first progress watched from its first frame", async () => {
  const fresh = CATALOGUE.find((action) => action.name === "open-app-fresh");
  const did = [];
  // The page's clock restarts with the start: the old document read 5000 ms; the new one's first frame showed the bar at 40 ms.
  const readings = [
    { t: 300, inputs: 0, progress: true, startSettled: false },
    { t: 900, inputs: 0, progress: true, startSettled: false },
    { t: 1400, inputs: 0, progress: false, startSettled: true },
  ];
  const page = {
    evaluate: async (source) => {
      if (source.includes("localStorage")) return did.push(`forget ${source.match(/\[.*?\]/)[0]}`);
      if (source.includes("__progressAt")) return 40;
      if (source.includes("window.__ev.filter")) return { ev: [], loaf: [{ start: 100, duration: 80, scripts: [] }] };
      if (source.includes("requestAnimationFrame")) return readings.shift() ?? { t: 1500, inputs: 0, progress: false, startSettled: true };
      return { t: 5000, inputs: 7 };
    },
    reload: async (options) => did.push(`reload ${options.waitUntil}`),
  };
  const round = await performRound(page, fresh, { mark: async () => 0, since: async () => ({}) });
  assert.deepEqual(did, ['forget ["storytree.forest.tree.v1:","storytree.forest.drawing.v1:"]', "reload domcontentloaded"]);
  assert.equal(round.settled, 1400);
  assert.equal(round.inputs, 0);
  assert.equal(round.response, null);
  assert.equal(round.progressAt, 40);
  assert.equal(round.progressHeld, true);
  assert.deepEqual(judge({ name: fresh.name, budget: fresh.budget, rounds: [round] }).verdict, { response: "n/a", smooth: "missed", settled: "within" });
});

test("8.18 pnpm lag:desktop turns the map by a Ctrl+drag from an uncovered point of its canvas, reads its frames, and reads NOT RUN when the map did not turn", async () => {
  const turn = CATALOGUE.find((action) => action.name === "turn-forest");
  /** A page whose canvas is uncovered at its middle; the map's places move once the drag has moved, unless `stuck`. */
  const fake = (stuck) => {
    const did = [];
    let moves = 0;
    const page = {
      did,
      evaluate: async (source) => {
        if (source.includes("getBoundingClientRect")) return { matches: 0, box: null };
        if (source.includes("elementFromPoint")) return null;
        if (source.includes("__turnFrames = [")) return did.push("record frames");
        if (source.includes("__turnFrames")) return [0, 16, 33, 50, 134, 150];
        if (source.includes("islands()")) return did.includes("up") && !stuck ? [[140, 100], [300, 220]] : [[100, 100], [300, 200]];
        if (source.includes("window.__ev.filter")) return { ev: [], loaf: [{ start: 50, duration: 84, scripts: [] }] };
        if (source.includes("requestAnimationFrame")) return { t: 2000, inputs: 3, mode: "forest", panelOpen: false, still: true, progress: false, startSettled: true };
        return { t: 1000, inputs: 0 };
      },
      locator: () => ({ first: () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 800, height: 600 }) }) }),
      keyboard: { press: async (key) => did.push(`press ${key}`), down: async (key) => did.push(`down ${key}`), up: async (key) => did.push(`up ${key}`) },
      mouse: { move: async () => { moves++; }, down: async () => did.push("down"), up: async () => did.push("up") },
      moves: () => moves,
    };
    return page;
  };
  const ipc = { mark: async () => 0, since: async () => ({}) };
  const page = fake(false);
  const round = await performRound(page, turn, ipc);
  // Ctrl is held for the whole drag, and the frames are recorded in the page across it.
  assert.deepEqual(page.did, ["press Escape", "record frames", "down Control", "down", "up", "up Control"]);
  assert.ok(page.moves() >= 360, "a drag of many steps");
  assert.deepEqual(round.turn, { p50: 17, p95: 84, max: 84, over: 1 });
  assert.equal(round.settled, null, "a turn has nothing to settle");
  const row = judge({ name: turn.name, budget: turn.budget, rounds: [round, round] });
  assert.deepEqual([row.response, row.turn, row.verdict], [undefined, { p50: 17, p95: 84, max: 84, over: 2 }, { response: "n/a", smooth: "missed", settled: "n/a" }]);
  assert.match(actionTable([row]).split("\n").at(-1), /^turn-forest frames: p50 17 \/ p95 84 ms, longest 84 ms, 2 over 50 ms$/);

  // Two builds compare a turn by its frames' 95th percentile.
  const compared = compareAction({ name: turn.name, budget: turn.budget, rounds: [{ ...round, turn: { ...round.turn, p95: 160 } }] }, { name: turn.name, budget: turn.budget, rounds: [round] });
  assert.deepEqual([compared.measure, compared.against, compared.this, compared.verdict], ["frame p95", 84, 160, "slower"]);

  await assert.rejects(performRound(fake(true), turn, ipc), (error) => error instanceof NotRun && /did not turn/.test(error.message));
});

test("8.21 pnpm lag:desktop ends a round that stalls within its deadline NOT RUN naming the wait it stalled in, writes result.json and stops the app it started", async () => {
  const turn = CATALOGUE.find((action) => action.name === "turn-forest");
  const idle = CATALOGUE.find((action) => action.name === "idle");
  const never = new Promise(() => {});
  // A page that answers until its frames stop coming: every read that waits for a frame (requestAnimationFrame) never returns.
  const page = {
    evaluate: async (source) => {
      if (source.includes("requestAnimationFrame")) return never;
      if (source.includes("getBoundingClientRect")) return { matches: 0, box: null };
      if (source.includes("elementFromPoint")) return null;
      return source.includes("islands()") ? [[1, 1]] : { t: 0, inputs: 0 };
    },
    locator: () => ({ first: () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 800, height: 600 }) }) }),
    keyboard: { press: async () => {}, down: async () => {}, up: async () => {} },
    mouse: { move: async () => {}, down: async () => {}, up: async () => {} },
    waitForTimeout: async () => {},
    addInitScript: async () => {},
    context: () => ({ newCDPSession: async () => ({ send: async (method) => (method === "Profiler.stop" ? never : {}) }) }),
  };
  const ipc = { mark: async () => 0, since: async () => ({}), all: async () => [] };
  const out = mkdtempSync(path.join(tmpdir(), "lag-stall-"));
  try {
    const { side, finish } = await startMeasuring({ page, ipc, state: "ready", readyMs: 1, extra: async () => ({}) }, { out, size: "live", deadlineMs: 50 });
    const began = Date.now();
    const performed = await alternate([turn, idle], 10, [side], { deadlineMs: () => 100 });
    assert.ok(Date.now() - began < 5000, "the stalled round ends at its deadline, not when the page answers");
    const [stalled, after] = performed[0];
    assert.match(stalled.notRun, /^stalled: nothing for 100 ms while waiting for .*frame/);
    assert.match(after.notRun, /^not performed: turn-forest stalled/);
    await finish(performed[0]);
    const kept = JSON.parse(readFileSync(path.join(out, "result.json"), "utf8"));
    assert.deepEqual(kept.actions.map((action) => action.notRun === undefined), [false, false]);
    assert.equal(exitCode(kept.actions.map(judge)), 3);

    // Stalled past state ready: every action reads NOT RUN naming that wait, and none is performed.
    const stuck = { ...page, evaluate: async () => never };
    const ready = await startMeasuring({ page: stuck, ipc, state: "ready", readyMs: 1, extra: async () => ({}) }, { out, size: "live", deadlineMs: 50 });
    const [[first]] = await alternate([idle], 3, [ready.side], { deadlineMs: () => 100 });
    assert.match(first.notRun, /^not performed: the run stalled past state ready, nothing for 50 ms while waiting for /);
  } finally {
    await removeTemp(out);
  }

  // The app is stopped: closed, or killed when closing does not return.
  const killed = [];
  await closeApp({ close: () => never, process: () => ({ kill: (signal) => killed.push(signal) }) }, 50);
  assert.deepEqual(killed, ["SIGKILL"]);
  const closed = [];
  await closeApp({ close: async () => closed.push("closed"), process: () => ({ kill: (signal) => killed.push(signal) }) }, 50);
  assert.deepEqual([closed, killed], [["closed"], ["SIGKILL"]]);
});
