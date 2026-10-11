// Capability 8 · Lag instruments. `pnpm lag:desktop`: what a user's actions cost in the desktop app (ADR-0836), measured by name
// against their budgets (ADR-1001 D1, D2). It performs the catalogue of named actions (@storytree/forest/actions: open the island
// with the fewest capabilities, the most, a named story's; close the panel; Library and back; open a Library note; open a
// session's row; a hover sweep; ten seconds idle) for a number of rounds, each through real input: a real mouse click at the
// island's place on screen, which the page's locator (window.storytreeGlobe) gives. Per round it records:
// - the response (the input's Event Timing, input to paint), the frames over 50 ms until settled with the scripts each names,
//   the settled time (the page shows what the entry says settled looks like), whether a sign of progress showed, and the IPC
//   calls the action made, counted by channel;
// - over the whole run, each IPC handler's time and answer size, event-loop lag in the main process, and a CPU profile.
// It prints one table, a row per action, against each budget, then the run's summary, and writes result.json (every round)
// and renderer.cpuprofile to the out folder. An action it could not perform reads NOT RUN with the reason, and the run exits 3.
// A report, never a gate (ADR-0623): no timing enters `pnpm test`.
//
//   pnpm lag:desktop [--action <name>] [--rounds <n>] [--story <title>] [--project <name>] [--out <dir>]
//                    [--home-from <dir>|none] [--home <dir>]
//   pnpm lag:desktop --chromium [--seed code-rows|forest] [--action <name>] [--rounds <n>] [--story <title>] [--out <dir>]
//   pnpm lag:desktop --analyze <dir>      reprint a run's table and summary
//
// --story names the island open-named-island opens (default: the library's, the owner's case). --home names the throwaway
// home: the first run on it starts cold, and a later run on the same home starts warm from the reading the first one kept.
//
// The app runs in Electron on a throwaway STORYTREE_HOME holding copies of the real home's settings.json, machine.json,
// project-choice.json and auth.json (the keys, among them the library's Postgres password, kept readable by the user alone), so
// it reads the same live library while the running app is left alone. APP_DIR is the desktop app to launch (default: this
// checkout's apps/desktop, built first with `pnpm --filter @storytree/desktop build`; on the laptop, an installed slot's
// apps/desktop), ELECTRON_EXE the Electron to run it with (default: the one APP_DIR installed), and ELECTRON_ARGS switches to
// give it. --home-from names the home to copy settings from (default: STORYTREE_HOME, else ~/.storytree/0.3); `none` starts the
// app on an empty home.
//
// --chromium runs the same catalogue on the desktop page in headless Chromium over the capture kit's stand-in bridge, on a library
// snapshot (`--seed`, default code-rows: storytree's own), for a machine where Electron cannot run. On the Mint box Electron
// crashes at launch (SIGSEGV, with or without --ozone-platform=headless and SwiftShader), so the box runs --chromium.

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CATALOGUE, chooseIsland, isSettled, NAMED_STORY } from "@storytree/forest/actions";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const SETTINGS = ["settings.json", "machine.json", "project-choice.json", "auth.json"];

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);

/**
 * The throwaway home a run starts the app on. Given `home`, a home an earlier run left, it is reused as it is,
 * so the app starts warm from the reading it kept there; otherwise a fresh one is made, holding copies of
 * `homeFrom`'s settings (none when `homeFrom` is `none`), so the app starts cold.
 */
export function lagHome({ home, homeFrom }) {
  if (home !== undefined && existsSync(path.join(home, "electron"))) return { home, warm: true };
  const made = home ?? mkdtempSync(path.join(tmpdir(), "lag-desktop-home-"));
  mkdirSync(made, { recursive: true });
  if (homeFrom !== "none") for (const file of SETTINGS) if (existsSync(path.join(homeFrom, file))) cpSync(path.join(homeFrom, file), path.join(made, file));
  if (existsSync(path.join(made, "auth.json"))) chmodSync(path.join(made, "auth.json"), 0o600);
  return { home: made, warm: false };
}

/** Watch the page: Event Timing (input to paint) and Long Animation Frames, kept in window.__ev and window.__loaf. */
const OBSERVE = `(() => {
  window.__ev = [];
  window.__loaf = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__ev.push({ name: e.name, start: e.startTime, duration: e.duration, inputDelay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart, presentation: e.startTime + e.duration - e.processingEnd });
  }).observe({ type: "event", durationThreshold: 16, buffered: false });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__loaf.push({
        start: e.startTime, duration: e.duration, blocking: e.blockingDuration,
        render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
        styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
        scripts: e.scripts.map((s) => ({ fn: s.sourceFunctionName, src: (s.sourceURL || "").split("/").pop(), pos: s.sourceCharPosition, inv: s.invoker, type: s.invokerType, dur: s.duration })),
      });
    }
  }).observe({ type: "long-animation-frame", buffered: false });
})()`;

/** The inputs the page has seen so far: a hover counts by the elements it enters. */
const INPUTS = `["pointerdown", "pointerover", "keydown"].reduce((sum, name) => sum + (performance.eventCounts?.get(name) ?? 0), 0)`;

/** What the page shows after its next frame, as the catalogue's `isSettled` reads it, with the inputs the page has seen so far. */
const READ_PAGE = `(async () => {
  await new Promise(requestAnimationFrame);
  const panel = document.querySelector(".story-panel");
  const shown = (element) => !element.hidden && element.getClientRects().length > 0;
  return { t: performance.now(), inputs: ${INPUTS}, selected: document.body.dataset.selected, note: document.body.dataset.note,
    panelOpen: panel !== null && !panel.hidden, mode: document.querySelector("[data-forest-mode][aria-pressed=true]")?.dataset.forestMode,
    sessionSelected: document.querySelector(".session-row[data-selected]") !== null, still: window.storytreeGlobe?.still() ?? true,
    progress: [...document.querySelectorAll("[role=progressbar], [aria-busy=true]")].some(shown) };
})()`;

/** A round that could not be performed: it reads NOT RUN with `message`. */
class NotRun extends Error {}

/** Poll the page each frame until it shows `until` (for `island`), or NOT RUN after `limitMs`. Returns the readings taken. */
async function waitFor(page, until, island, limitMs) {
  const readings = [];
  const end = Date.now() + limitMs;
  for (;;) {
    const reading = await page.evaluate(READ_PAGE);
    readings.push(reading);
    if (isSettled(until, reading, island)) return readings;
    if (Date.now() > end) throw new NotRun(`settled (${JSON.stringify(until)}) not reached within ${limitMs} ms`);
  }
}

/** Where a click at (x, y) lands, unless it is the globe's canvas: the page's own hit test. */
const covering = (page, { x, y }) => page.evaluate(`(() => { const at = document.elementFromPoint(${x}, ${y});
  return at === null ? "nothing" : at.tagName === "CANVAS" ? null : at.tagName.toLowerCase() + (at.className ? "." + String(at.className).split(" ")[0] : ""); })()`);

/** A visible, uncovered point of the globe's (an island's or a note's), or NOT RUN saying why there is none. */
async function globePoint(page, places, what) {
  for (const place of places.filter((place) => place.visible)) if ((await covering(page, place)) === null) return place;
  throw new NotRun(places.some((place) => place.visible) ? `${what} is covered on screen` : `${what} is not in view`);
}

/**
 * Get one step ready without measuring it (find its island or element, turn the globe to face it) and return the input that performs
 * it. `round.island` is set to the story an island step clicks, for its settled condition.
 */
async function prepare(page, step, round, limitMs) {
  if (step.kind === "island") {
    const islands = await page.evaluate("window.storytreeGlobe?.islands() ?? null");
    if (islands === null) throw new NotRun("the page offers no island locator (window.storytreeGlobe)");
    const story = chooseIsland(step.island, islands);
    const named = typeof step.island === "object" ? `"${step.island.story}"` : `with the ${step.island} capabilities`;
    if (story === undefined) throw new NotRun(`no island ${named} on the globe`);
    await page.evaluate(`window.storytreeGlobe.face(${JSON.stringify({ kind: "story", story })})`);
    await waitFor(page, { still: true }, undefined, limitMs);
    const at = await globePoint(page, (await page.evaluate("window.storytreeGlobe.islands()")).filter((island) => island.story === story), `the island ${named}`);
    round.island = story;
    return () => page.mouse.click(at.x, at.y);
  }
  if (step.kind === "note") {
    const notes = await page.evaluate("window.storytreeGlobe?.notes() ?? null");
    if (notes === null) throw new NotRun("the page offers no note locator (window.storytreeGlobe)");
    const at = await globePoint(page, notes, "a Library note");
    return () => page.mouse.click(at.x, at.y);
  }
  if (step.kind === "click") {
    // The first match drawn with a size, measured by the page itself, so a panel that redraws between reads is still found.
    const found = await page.evaluate(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(step.selector)})];
      const rect = all.map((element) => element.getBoundingClientRect()).find((rect) => rect.width > 0 && rect.height > 0);
      return { matches: all.length, box: rect === undefined ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }; })()`);
    const { box } = found;
    if (box === null) {
      if (step.optional) return async () => {};
      throw new NotRun(found.matches === 0 ? `nothing on the page matches ${step.selector}` : `${step.selector} is not on show`);
    }
    return () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  if (step.kind === "key") return () => page.keyboard.press(step.key);
  if (step.kind === "idle") return () => page.waitForTimeout(step.ms);
  if (step.kind === "wait") return () => waitFor(page, step.until, round.island, limitMs);
  // A hover sweep across the globe: every move picks.
  const canvas = await page.locator("canvas").first().boundingBox({ timeout: 2000 }).catch(() => null);
  if (canvas === null) throw new NotRun("no globe canvas on the page");
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;
  const r = Math.min(canvas.width, canvas.height) * 0.35;
  return async () => {
    await page.mouse.move(cx - r, cy - r * 0.3);
    await page.mouse.move(cx + r, cy + r * 0.3, { steps: 80 });
    await page.mouse.move(cx - r * 0.2, cy + r, { steps: 80 });
  };
}

/**
 * One round of `action`: its setup, unmeasured, then its steps through real input, read each frame until settled. Records the
 * response (the longest Event Timing from the first input), the frames over 50 ms until settled with the scripts each names, the
 * settled time, when a sign of progress showed and whether it stayed, and the IPC calls made, by channel.
 */
async function performRound(page, action, ipc) {
  const round = {};
  for (const step of action.setup) await (await prepare(page, step, round, action.limitMs))();
  const calls = await ipc.mark();
  let before;
  for (const step of action.perform) {
    const act = await prepare(page, step, round, action.limitMs);
    before ??= await page.evaluate(`({ t: performance.now(), inputs: ${INPUTS} })`);
    await act();
  }
  const start = before.t;
  const readings = await waitFor(page, action.settled, round.island, action.limitMs);
  const settledAt = readings.at(-1).t;
  // Event Timing reports after the paint: two frames more so the last input's entry has arrived.
  await page.evaluate(READ_PAGE);
  const after = await page.evaluate(READ_PAGE);
  const { ev, loaf } = await page.evaluate(`({ ev: window.__ev.filter((e) => e.start >= ${start} && e.start <= ${settledAt}),
    loaf: window.__loaf.filter((e) => e.start + e.duration >= ${start} && e.start <= ${settledAt}) })`);
  const shown = readings.findIndex((reading) => reading.progress);
  return {
    ...(round.island === undefined ? {} : { island: round.island }),
    inputs: after.inputs - before.inputs,
    response: ev.length === 0 ? null : Math.max(...ev.map((e) => e.duration)),
    frames: loaf.map((e) => ({ duration: e.duration, scripts: e.scripts.map((s) => `${s.inv}/${s.fn}`) })),
    // An action with nothing to settle (a hover sweep, idle) has no settled time: its own length is not a wait.
    settled: Object.keys(action.settled).length === 0 ? null : settledAt - start,
    ...(shown === -1 ? {} : { progressAt: readings[shown].t - start, progressHeld: readings.slice(shown).every((reading) => reading.progress || isSettled(action.settled, reading, round.island)) }),
    ipc: await ipc.since(calls),
  };
}

/** Perform each of `actions` for `rounds` rounds; an action's first round that cannot be performed ends it as NOT RUN. */
async function performActions(page, actions, rounds, ipc, mark) {
  const performed = [];
  for (const action of actions) {
    await mark(action.name);
    const done = { name: action.name, budget: action.budget, rounds: [] };
    for (let n = 0; n < rounds; n++) {
      try {
        done.rounds.push(await performRound(page, action, ipc));
      } catch (error) {
        if (!(error instanceof NotRun)) throw error;
        done.notRun = error.message;
        break;
      }
    }
    log(action.name, done.notRun === undefined ? `${done.rounds.length} rounds` : `NOT RUN: ${done.notRun}`);
    performed.push(done);
  }
  await mark("end");
  return performed;
}

/** Run the catalogue on a ready `page`, and write result.json and renderer.cpuprofile into `out`. */
async function measurePage(page, { actions, rounds, out, ipc, state, readyMs, extra }) {
  await page.waitForTimeout(3000);
  await page.evaluate(OBSERVE);
  const marks = [];
  const mark = async (label) => marks.push({ label, perf: await page.evaluate("performance.now()"), wall: Date.now() });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const performed = await performActions(page, actions, rounds, ipc, mark);
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync(path.join(out, "renderer.cpuprofile"), JSON.stringify(profile));
  const ev = await page.evaluate("window.__ev");
  const loaf = await page.evaluate("window.__loaf");
  const mem = await page.evaluate("({ heap: performance.memory?.usedJSHeapSize, nodes: document.getElementsByTagName('*').length })");
  writeFileSync(path.join(out, "result.json"), JSON.stringify({ state, readyMs, marks, actions: performed, ev, loaf, ipc: await ipc.all(), mem, ...(await extra()) }, null, 1));
  log("wrote", path.join(out, "result.json"));
}

/** Launch the built desktop app in Electron and run the catalogue on it; IPC is its main process's handlers, wrapped. */
async function measureElectron({ appDir, exe, extraArgs, home: reuse, homeFrom, project, out, actions, rounds }) {
  const { _electron } = await import("playwright-core");
  const { home, warm } = lagHome({ home: reuse, homeFrom });
  log("home", home, warm ? "(warm: reused)" : homeFrom === "none" ? "(empty)" : `(settings from ${homeFrom})`);

  const began = Date.now();
  const app = await _electron.launch({ executablePath: exe, args: [...extraArgs, appDir, ...(project ? ["--project", project] : [])], env: { ...process.env, STORYTREE_HOME: home }, timeout: 180_000 });
  app.process().stdout.on("data", (data) => process.stdout.write(`[main] ${data}`));
  app.process().stderr.on("data", (data) => process.stdout.write(`[main!] ${data}`));
  try {
    const wrapped = await app.evaluate(({ ipcMain }) => {
      globalThis.__ipc = [];
      globalThis.__lag = [];
      const wrap = (channel, fn) => async (...args) => {
        const start = performance.now();
        try {
          const answer = await fn(...args);
          let size = 0;
          try {
            size = JSON.stringify(answer)?.length ?? 0;
          } catch {}
          globalThis.__ipc.push({ channel, at: Date.now(), ms: performance.now() - start, size });
          return answer;
        } catch (error) {
          globalThis.__ipc.push({ channel, at: Date.now(), ms: performance.now() - start, error: String(error?.message ?? error) });
          throw error;
        }
      };
      const handlers = ipcMain._invokeHandlers;
      if (handlers) for (const [channel, fn] of handlers) handlers.set(channel, wrap(channel, fn));
      const handle = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (channel, fn) => handle(channel, wrap(channel, fn));
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        const lag = now - last - 50;
        if (lag > 20) globalThis.__lag.push({ at: Date.now(), lag });
        last = now;
      }, 50).unref();
      return handlers ? handlers.size : -1;
    });
    log("wrapped IPC handlers:", wrapped);

    const page = await app.firstWindow();
    log("window after", Date.now() - began, "ms");
    await page.waitForFunction(() => document.body?.dataset.state === "ready" || document.body?.dataset.state === "error", null, { timeout: 180_000, polling: 100 });
    const state = await page.evaluate(() => document.body.dataset.state);
    const readyMs = Date.now() - began;
    log("state", state, "after", readyMs, "ms");
    const read = () => app.evaluate(() => globalThis.__ipc);
    const ipc = { mark: async () => (await read()).length, since: async (from) => byChannel((await read()).slice(from)), all: read };
    await measurePage(page, { actions, rounds, out, ipc, state, readyMs, extra: async () => ({ lag: await app.evaluate(() => globalThis.__lag) }) });
  } finally {
    await app.close().catch(() => {});
  }
}

/**
 * Run the catalogue on the desktop page in headless Chromium over the capture kit's stand-in bridge (apps/desktop/src/capture),
 * on a library snapshot (`seed`): for a machine where Electron cannot run, as on the Mint box. IPC is the bridge's calls.
 * The kit is the app's own TypeScript, loaded at run time through tsx, as the evidence captures load it: no package depends on it.
 */
async function measureChromium({ seed: seedName, out, actions, rounds }) {
  const { register } = await import("tsx/esm/api");
  register();
  const kit = await import(pathToFileURL(path.join(root, "apps", "desktop", "src", "capture", "index.ts")).href);
  const { seed, survey } = kit.captureSeed(seedName);
  const dist = path.join(out, "page");
  await kit.buildCapture({ dist });
  const calls = [];
  const counted = (channel, answer) => async (...args) => {
    calls.push({ channel, at: Date.now() });
    return answer(...args);
  };
  let current = seed.projects[0];
  const answers = {
    projectSelection: async () => ({ projects: seed.projects, current }),
    chooseProject: async (name) => ({ projects: seed.projects, current: (current = name) }),
    listProjects: async () => seed.projects,
    projectTree: async () => seed.tree,
    changesSince: async (_, cursor) => (cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor }),
    linesSince: async (_, cursor) => (cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor }),
    frontCovers: async (_, id) => seed.covers[id] ?? [],
    ...(survey === undefined ? {} : { codeSurvey: async () => survey }),
  };
  const bridge = kit.fakeBridge(Object.fromEntries(Object.entries(answers).map(([channel, answer]) => [channel, counted(channel, answer)])));
  await kit.withCapture({ folder: path.join(out, "capture"), dist }, async ({ browser, origin }) => {
    const began = Date.now();
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
    await bridge.install(page);
    await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await bridge.ready(page, 180_000);
    const readyMs = Date.now() - began;
    log("state ready after", readyMs, "ms, on the", seedName, "snapshot");
    const ipc = { mark: async () => calls.length, since: async (from) => byChannel(calls.slice(from)), all: async () => calls };
    await measurePage(page, { actions, rounds, out, ipc, state: "ready", readyMs, extra: async () => ({ lag: [], page: "chromium", seed: seedName, defaulted: bridge.defaulted }) });
  });
}

/** Calls counted by channel. */
function byChannel(calls) {
  const counts = {};
  for (const call of calls) counts[call.channel] = (counts[call.channel] ?? 0) + 1;
  return counts;
}

/** The lower median of `values`. */
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

/**
 * One action's row from its recorded rounds, judged against its budget on the worst round (ADR-1001 D2: "at every size, with no
 * exception"). A round's response with no Event Timing entry was under the browser's 16 ms threshold; an action that made no input
 * has no response to judge, and one with nothing to settle (its rounds' settled is null) no settled time. A round is settled in budget within `settledMs`, or when progress showed within the response budget
 * and stayed until settled. An action with a round it could not perform is NOT RUN, with the reason.
 */
export function judge({ name, budget, rounds, notRun }) {
  if (notRun !== undefined) return { name, notRun, rounds: rounds.length };
  const responses = rounds.filter((round) => round.inputs > 0).map((round) => round.response ?? 0);
  const longest = Math.max(0, ...rounds.flatMap((round) => round.frames.map((frame) => frame.duration)));
  const settled = rounds.map((round) => round.settled).filter((ms) => ms !== null);
  const ipc = rounds.map((round) => Object.values(round.ipc).reduce((sum, n) => sum + n, 0));
  const settledWithin = (round) => round.settled === null || round.settled <= budget.settledMs || (round.progressAt !== undefined && round.progressAt <= budget.responseMs && round.progressHeld);
  return {
    name, rounds: rounds.length,
    response: responses.length === 0 ? undefined : { median: median(responses), worst: Math.max(...responses) },
    longestFrame: longest,
    settled: settled.length === 0 ? undefined : { median: median(settled), worst: Math.max(...settled) },
    ipc: median(ipc),
    verdict: {
      response: responses.length === 0 ? "n/a" : Math.max(...responses) <= budget.responseMs ? "within" : "missed",
      smooth: longest <= budget.frameMs ? "within" : "missed",
      settled: settled.length === 0 ? "n/a" : rounds.every(settledWithin) ? "within" : "missed",
    },
  };
}

/** The table, a row per judged action: median and worst response, the longest frame, settled, the IPC count, and each verdict. */
export function actionTable(rows) {
  const ms = (n) => (n === 0 ? "<16" : n.toFixed(0));
  const lines = [["action", "rounds", "response p50/worst", "longest frame", "settled p50/worst", "IPC", "response", "smooth", "settled"]];
  for (const row of rows) {
    if (row.notRun !== undefined) lines.push([row.name, String(row.rounds), `NOT RUN: ${row.notRun}`]);
    else lines.push([row.name, String(row.rounds), row.response === undefined ? "-" : `${ms(row.response.median)} / ${ms(row.response.worst)} ms`,
      row.longestFrame === 0 ? "none over 50" : `${row.longestFrame.toFixed(0)} ms`, row.settled === undefined ? "-" : `${row.settled.median.toFixed(0)} / ${row.settled.worst.toFixed(0)} ms`,
      String(row.ipc), row.verdict.response, row.verdict.smooth, row.verdict.settled]);
  }
  const widths = lines[0].map((_, column) => Math.max(...lines.filter((line) => line.length > 3).map((line) => line[column].length)));
  return lines.map((line) => (line.length > 3 ? line.map((cell, column) => cell.padEnd(widths[column])).join("  ") : `${line[0].padEnd(widths[0])}  ${line[1].padEnd(widths[1])}  ${line[2]}`).trimEnd()).join("\n");
}

/** 3 when any action could not be performed (NOT RUN), else 0: a missed budget is reported, never a failed run. */
export const exitCode = (rows) => (rows.some((row) => row.notRun !== undefined) ? 3 : 0);

/** The summary of the run in `out`: the actions' table, IPC by channel, each action's cost over its rounds, events, long frames, main-process lag and the profile's top functions. */
export function summary(out) {
  const r = JSON.parse(readFileSync(path.join(out, "result.json"), "utf8"));
  const lines = [];
  const say = (...parts) => lines.push(parts.join(" "));
  const q = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
  };
  const f = (n) => (Number.isFinite(n) ? n.toFixed(0) : "-").padStart(6);
  if (r.actions !== undefined) say(`${actionTable(r.actions.map(judge))}\n`);
  say(`state ${r.state} after ${r.readyMs} ms`);
  say("marks", r.marks.map((m) => `${m.label}@${new Date(m.wall).toISOString().slice(14, 23)}`).join("  "));
  const t0 = r.ipc[0]?.at;
  const t1 = r.ipc.at(-1)?.at;
  say(`\nIPC: ${r.ipc.length} calls over ${(((t1 ?? 0) - (t0 ?? 0)) / 1000).toFixed(0)} s`);
  const by = {};
  for (const call of r.ipc) (by[call.channel] ??= []).push(call);
  say("channel".padEnd(34), "  n   p50   p90   max  avgKB  errs");
  for (const [channel, calls] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    const ms = calls.map((c) => c.ms);
    say(channel.padEnd(34), String(calls.length).padStart(3), f(q(ms, 0.5)), f(q(ms, 0.9)), f(Math.max(...ms)), (calls.reduce((s, c) => s + (c.size ?? 0), 0) / calls.length / 1024).toFixed(1).padStart(6), String(calls.filter((c) => c.error).length).padStart(5));
  }
  for (let i = 0; i < r.marks.length - 1; i++) {
    const [a, b] = [r.marks[i].wall, r.marks[i + 1].wall];
    const [pa, pb] = [r.marks[i].perf, r.marks[i + 1].perf];
    const calls = r.ipc.filter((c) => c.at >= a && c.at < b);
    const counts = {};
    for (const c of calls) counts[c.channel.replace("storytree:", "")] = (counts[c.channel.replace("storytree:", "")] ?? 0) + 1;
    const ev = r.ev.filter((e) => e.start >= pa && e.start < pb);
    const lf = r.loaf.filter((e) => e.start >= pa && e.start < pb);
    const lg = (r.lag ?? []).filter((e) => e.at >= a && e.at < b);
    const blocked = lf.reduce((s, e) => s + e.duration, 0);
    say(`\n[${r.marks[i].label}] ${((b - a) / 1000).toFixed(1)} s: ${calls.length} IPC ->`, JSON.stringify(counts));
    say(`   blocked ${((100 * blocked) / (pb - pa)).toFixed(1)}%  long frames ${lf.length}, longest ${f(Math.max(0, ...lf.map((e) => e.duration)))} ms  events>=16ms ${ev.length}, longest ${f(Math.max(0, ...ev.map((e) => e.duration)))} ms  main lag>20ms ${lg.length}, worst ${f(Math.max(0, ...lg.map((e) => e.lag)))} ms`);
  }
  say("\nEvent timing by name (>=16 ms):");
  const named = {};
  for (const e of r.ev) (named[e.name] ??= []).push(e);
  for (const [name, es] of Object.entries(named)) say(name.padEnd(14), es.length, "p50", f(q(es.map((e) => e.duration), 0.5)), "max", f(Math.max(...es.map((e) => e.duration))), " delay p50", f(q(es.map((e) => e.inputDelay), 0.5)), "processing p50", f(q(es.map((e) => e.processing), 0.5)), "presentation p50", f(q(es.map((e) => e.presentation), 0.5)));
  say("\nTop long-frame script attributions (total ms):");
  const scripts = {};
  for (const l of r.loaf) for (const s of l.scripts) scripts[`${s.type}:${s.inv} ${s.fn}@${s.src}:${s.pos}`] = (scripts[`${s.type}:${s.inv} ${s.fn}@${s.src}:${s.pos}`] ?? 0) + s.dur;
  for (const [k, v] of Object.entries(scripts).sort((a, b) => b[1] - a[1]).slice(0, 15)) say(f(v), k);
  say("\nLongest frames:");
  for (const l of [...r.loaf].sort((a, b) => b.duration - a.duration).slice(0, 8)) say(f(l.duration), "render", f(l.render), "style/layout", f(l.styleLayout), l.scripts.map((s) => `${s.inv}/${s.fn}:${s.dur.toFixed(0)}`).join(" | "));
  say("\nmain lag worst:", [...(r.lag ?? [])].sort((a, b) => b.lag - a.lag).slice(0, 8).map((l) => l.lag.toFixed(0)).join(", "), " page", JSON.stringify(r.mem));
  const profile = path.join(out, "renderer.cpuprofile");
  if (existsSync(profile)) lines.push(...profileSummary(JSON.parse(readFileSync(profile, "utf8"))));
  return lines.join("\n");
}

/** The CPU profile's top functions by self and inclusive time. */
function profileSummary(p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map();
  let total = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const ms = (p.timeDeltas[i] ?? 0) / 1000;
    total += ms;
    self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + ms);
  }
  const name = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
  const selfBy = {};
  const inclusive = {};
  for (const [id, ms] of self) {
    selfBy[name(byId.get(id))] = (selfBy[name(byId.get(id))] ?? 0) + ms;
    const seen = new Set();
    for (let at = id; at !== undefined; at = parent.get(at)) {
      const k = name(byId.get(at));
      if (!seen.has(k)) inclusive[k] = (inclusive[k] ?? 0) + ms;
      seen.add(k);
    }
  }
  const top = (by, n) => Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(7)} ${k}`);
  return [`\nCPU profile: ${total.toFixed(0)} ms`, "Top self:", ...top(selfBy, 25), "\nTop inclusive:", ...top(inclusive, 45)];
}

async function main(args) {
  const analyze = option(args, "analyze", undefined);
  if (analyze !== undefined) {
    console.log(summary(path.resolve(analyze)));
    return 0;
  }
  const story = option(args, "story", NAMED_STORY);
  const named = option(args, "action", undefined);
  const catalogue = CATALOGUE.map((action) => ({ ...action, perform: action.perform.map((step) => (step.kind === "island" && typeof step.island === "object" ? { ...step, island: { story } } : step)) }));
  const actions = catalogue.filter((action) => named === undefined || action.name === named);
  if (actions.length === 0) throw new Error(`no action ${named} in the catalogue: ${CATALOGUE.map((action) => action.name).join(", ")}`);
  const rounds = Number(option(args, "rounds", "5"));
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error("--rounds takes a whole number of at least 1");
  const out = path.resolve(option(args, "out", path.join(tmpdir(), `lag-desktop-${new Date().toISOString().replace(/[:.]/g, "-")}`)));
  mkdirSync(out, { recursive: true });
  if (args.includes("--chromium")) await measureChromium({ seed: option(args, "seed", "code-rows"), out, actions, rounds });
  else {
    const appDir = path.resolve(process.env.APP_DIR ?? path.join(root, "apps", "desktop"));
    if (!existsSync(path.join(appDir, "dist", "main.cjs"))) throw new Error(`${appDir} has no dist/main.cjs: build it first (pnpm --filter @storytree/desktop build), or set APP_DIR to a built app`);
    const exe = process.env.ELECTRON_EXE ?? createRequire(path.join(appDir, "package.json"))("electron");
    const homeFrom = option(args, "home-from", process.env.STORYTREE_HOME ?? path.join(homedir(), ".storytree", "0.3"));
    const extraArgs = (process.env.ELECTRON_ARGS ?? "").split(" ").filter(Boolean);
    const home = option(args, "home", undefined);
    await measureElectron({ appDir, exe, extraArgs, home: home === undefined ? undefined : path.resolve(home), homeFrom, project: option(args, "project", undefined), out, actions, rounds });
  }
  console.log(`\n${summary(out)}`);
  console.log(`\nlag:desktop: the run is in ${out}`);
  return exitCode(JSON.parse(readFileSync(path.join(out, "result.json"), "utf8")).actions.map(judge));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`lag:desktop: ${error.message}`);
      process.exit(1);
    },
  );
}
