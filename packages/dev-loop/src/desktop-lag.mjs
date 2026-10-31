// Capability 8 · Lag instruments. `pnpm lag:desktop`: what a user's actions cost in the desktop app (ADR-0836), measured by name
// against their budgets (ADR-1001 D1, D2). It performs the catalogue of named actions (@storytree/forest/actions: open the island
// with the fewest capabilities, the most, a named story's; open the app again, with the forest the last start kept and without it; close the panel; Library and back; open a Library note; open a
// session's row; a hover sweep; turning the map, in the forest and the Library; ten seconds idle) for a number of rounds, each through
// real input: a real mouse click at the island's place on screen, which the page's locator (window.storytreeGlobe) gives, a Ctrl+drag
// for a turn, and opening the app as a real start of the page, timed from its navigation. Per round it records:
// - the response (the input's Event Timing, input to paint), the frames over 50 ms until settled with the scripts each names,
//   the settled time (the page shows what the entry says settled looks like), whether a sign of progress showed, and the IPC
//   calls the action made, counted by channel; a turn, the intervals between the page's frames across its drag;
// - over the whole run, each IPC handler's time and answer size, event-loop lag in the main process, and a CPU profile.
// It prints one table, a row per action and size, against each budget, then the run's summary, and writes result.json (every
// round) and renderer.cpuprofile to the out folder, a folder per size on a seeded run. An action it could not perform reads NOT RUN
// with the reason, and the run exits 3. A report, never a gate (ADR-0623): no timing enters `pnpm test`.
//
//   pnpm lag:desktop [--sizes standard,large] [--action <name>[,<name>...]] [--rounds <n>] [--story <title>] [--out <dir>] [--recorder on|off]
//   pnpm lag:desktop --live [--action <name>] [--rounds <n>] [--story <title>] [--project <name>] [--out <dir>]
//                    [--home-from <dir>|none] [--home <dir>] [--recorder on|off]
//   pnpm lag:desktop --chromium [--sizes standard,large | --snapshot code-rows|forest] [--action <name>] [--rounds <n>] [--story <title>] [--out <dir>]
//                    [--recorder on|off]
//   pnpm lag:desktop [--chromium] --against <ref | built app dir> [--sizes …] [--action <name>] [--rounds <n>] [--out <dir>]
//   pnpm lag:desktop --analyze <dir>      reprint a run's table and summary
//
// --against compares two builds in one run (ADR-1001 D3, D7): this checkout's and another, measured in turn round by round (A, B, A,
// B, ...) on the same seed, so the box's load falls on both. Per action it prints both medians, the difference and a verdict, slower,
// the same or faster past MARGIN, and a read whose count per round differs as its own finding; each build's run is kept in
// <out>/<size>/this and <out>/<size>/against. A ref is checked out into a throwaway worktree, installed with the repo's provisioning
// (and built, for Electron), and removed after; a built app dir (an apps/desktop, as APP_DIR names) is used where it is.
//
// Every run but --analyze queues behind the machine's heavy-run lock (heavy-lock.mjs) for its whole length.
//
// By default the run reads a library it seeds (lag-seed.mjs, the seed `pnpm lag:reads` reads), so two runs compare (ADR-1001 D1):
// a throwaway Postgres (STORYTREE_TEST_PG_URL's when set, otherwise its own in a temporary folder) holding the seed at each of
// --sizes (default both), a project per size, standing still while the run measures. The table's size column shows where an
// action's settled time crosses 1 s (ADR-1001 D2). --live reads the real library instead: the laptop's reading.
//
// --recorder off opens the page with the app's own lag recorder (Lag in real use) switched off, so a run with it and a run
// without show what recording costs; its `recordLag` calls are counted with the rest, by round.
//
// --story names the island open-named-island opens (default: the library's, the owner's case, which the seed's first story is).
//
// The app runs in Electron on a throwaway STORYTREE_HOME. Seeded, its settings.json names the seeded Postgres and auth.json holds
// its password, readable by the user alone, and --project opens the size's project. --live copies the real home's settings.json,
// machine.json, project-choice.json and auth.json instead (the keys kept readable by the user alone), so it reads the same live
// library while the running app is left alone: --home-from names the home to copy settings from (default: STORYTREE_HOME, else
// ~/.storytree/0.3; `none` starts the app on an empty home), and --home names the throwaway home: the first run on it starts cold,
// and a later run on the same home starts warm from the reading the first one kept. APP_DIR is the desktop app to launch (default:
// this checkout's apps/desktop, built first with `pnpm --filter @storytree/desktop build`; on the laptop, an installed slot's
// apps/desktop), ELECTRON_EXE the Electron to run it with (default: the one APP_DIR installed), and ELECTRON_ARGS switches to give it.
//
// --chromium runs the same catalogue on the desktop page in headless Chromium over the capture kit's stand-in bridge, for a machine
// where Electron cannot run: the bridge answers the page's reads from the seeded library, or from a library snapshot with
// --snapshot (code-rows: storytree's own; forest). On the Mint box Electron crashes at launch (SIGSEGV, with or without
// --ozone-platform=headless and SwiftShader), so the box runs --chromium.

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CATALOGUE, chooseIsland, isSettled, NAMED_STORY, turnFrames } from "@storytree/forest/actions";
import { connect } from "@storytree/library";
import { start } from "@storytree/local-postgres";
import { openActivityLog } from "@storytree/session-management";

import { acquireHeavyLock } from "./heavy-lock.mjs";
import { describeSize, seedLagProject, seedSize, SIZES } from "./lag-seed.mjs";
import { provision } from "./provision-worktree.mjs";

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

/**
 * A throwaway home whose settings name the Postgres at `url` as the library, its address without the password, and whose auth.json
 * holds the password as the key `postgres`, readable by the user alone: the app reads the seeded library and nothing else.
 */
export function seededHome(url) {
  const home = mkdtempSync(path.join(tmpdir(), "lag-desktop-home-"));
  const address = new URL(url);
  const key = decodeURIComponent(address.password);
  address.password = "";
  writeFileSync(path.join(home, "settings.json"), `${JSON.stringify({ library: { location: "postgres", address: address.toString() } }, null, 2)}\n`);
  writeFileSync(path.join(home, "auth.json"), JSON.stringify({ postgres: { key } }), { mode: 0o600 });
  chmodSync(path.join(home, "auth.json"), 0o600);
  return home;
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
    panelOpen: panel !== null && !panel.hidden, mode: document.querySelector("[data-forest-mode]")?.dataset.forestMode,
    sessionSelected: document.querySelector(".session-row[data-selected]") !== null, still: window.storytreeGlobe?.still() ?? true,
    progress: [...document.querySelectorAll("[role=progressbar], [aria-busy=true]")].some(shown), startSettled: document.body.dataset.start === "settled" };
})()`;

/**
 * Run on every document the page opens after the first, from its start: the frames and inputs are watched (OBSERVE), and the first
 * frame that shows a loading bar or circle is kept in window.__progressAt, since the readings of a start begin only once its document
 * has loaded.
 */
const ON_START = `${OBSERVE};
(() => {
  const look = () => {
    if ([...document.querySelectorAll("[role=progressbar], [aria-busy=true]")].some((element) => !element.hidden && element.getClientRects().length > 0)) {
      window.__progressAt = performance.now();
      return;
    }
    if (document.body?.dataset.start !== "settled") requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
})()`;

/** A round that could not be performed: it reads NOT RUN with `message`. */
export class NotRun extends Error {}

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

/** Where the map's islands and notes are on screen, or null when the page offers no locator: a turn of the map moves them. */
const PLACES = `(() => { const globe = window.storytreeGlobe;
  return globe === undefined ? null : [...globe.islands(), ...globe.notes()].map((place) => [Math.round(place.x), Math.round(place.y)]); })()`;

/** Record the page's frame times (requestAnimationFrame's) in window.__turnFrames until TURN_FRAMES_STOP takes them. */
const TURN_FRAMES = `(() => { window.__turnFrames = [];
  const tick = (time) => { if (window.__turnFrames === undefined) return; window.__turnFrames.push(time); requestAnimationFrame(tick); };
  requestAnimationFrame(tick); })()`;
const TURN_FRAMES_STOP = "(() => { const times = window.__turnFrames ?? []; window.__turnFrames = undefined; return times; })()";

/** A turn's drag: this many steps, sideways across this share of the canvas, with a tilt wave of this share up and down. */
const TURN = { steps: 360, across: 0.4, tilt: 0.08 };

/** A point of the canvas `box` the page's own hit test reports as the canvas, left of the middle so the drag stays on it. */
async function canvasPoint(page, box) {
  for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) for (const fx of [0.3, 0.4, 0.2]) {
    const at = { x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) };
    if ((await covering(page, at)) === null) return at;
  }
  throw new NotRun("the globe canvas is covered on screen");
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
  if (step.kind === "turn") {
    // Ctrl held and a left drag from an uncovered point of the canvas, as a user spins and tilts the map, its frames recorded in the
    // page across the drag; `round.turnTimes` keeps them. Unless an island or a note moved, the map did not turn: NOT RUN.
    const box = await page.locator("canvas").first().boundingBox({ timeout: 2000 }).catch(() => null);
    if (box === null) throw new NotRun("no globe canvas on the page");
    const at = await canvasPoint(page, box);
    const before = await page.evaluate(PLACES);
    if (before === null) throw new NotRun("the page offers no island locator (window.storytreeGlobe)");
    return async () => {
      await page.evaluate(TURN_FRAMES);
      await page.keyboard.down("Control");
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (let n = 1; n <= TURN.steps; n++) {
        await page.mouse.move(at.x + (box.width * TURN.across * n) / TURN.steps, at.y + box.height * TURN.tilt * Math.sin((4 * Math.PI * n) / TURN.steps));
      }
      await page.mouse.up();
      await page.keyboard.up("Control");
      round.turnTimes = await page.evaluate(TURN_FRAMES_STOP);
      if (JSON.stringify(await page.evaluate(PLACES)) === JSON.stringify(before)) throw new NotRun("the map did not turn: no island or note moved on screen");
    };
  }
  if (step.kind === "wait") return () => waitFor(page, step.until, round.island, limitMs);
  if (step.kind === "start") {
    // A start of the page, as opening the app is: the keys it names forgotten first, so the page starts without what they kept.
    return async () => {
      await page.evaluate(`for (const key of Object.keys(localStorage)) if (${JSON.stringify(step.forget)}.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key)`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: limitMs });
    };
  }
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
 * settled time, when a sign of progress showed and whether it stayed, and the IPC calls made, by channel. A start is timed on its
 * own document's clock, from its navigation, and makes no input.
 */
export async function performRound(page, action, ipc) {
  const starts = action.perform.some((step) => step.kind === "start");
  const round = {};
  for (const step of action.setup) await (await prepare(page, step, round, action.limitMs))();
  let before;
  let calls;
  for (const step of action.perform) {
    const act = await prepare(page, step, round, action.limitMs);
    // Counted from the first input on: turning an island to face, in prepare, is unmeasured.
    before ??= await page.evaluate(`({ t: performance.now(), inputs: ${INPUTS} })`);
    calls ??= await ipc.mark();
    await act();
  }
  const start = starts ? 0 : before.t;
  const readings = await waitFor(page, action.settled, round.island, action.limitMs);
  const settledAt = readings.at(-1).t;
  const settledCalls = await ipc.mark();
  // Event Timing reports after the paint: two frames more so the last input's entry has arrived.
  await page.evaluate(READ_PAGE);
  const after = await page.evaluate(READ_PAGE);
  const { ev, loaf } = await page.evaluate(`({ ev: window.__ev.filter((e) => e.start >= ${start} && e.start <= ${settledAt}),
    loaf: window.__loaf.filter((e) => e.start + e.duration >= ${start} && e.start <= ${settledAt}) })`);
  const shown = readings.findIndex((reading) => reading.progress);
  // A start's first sign of progress is watched from its first frame (ON_START); its readings show whether it stayed.
  const watched = starts ? await page.evaluate("window.__progressAt ?? null") : null;
  const progressAt = [watched, shown === -1 ? null : readings[shown].t].filter((t) => t !== null);
  const held = readings.slice(Math.max(0, shown)).every((reading) => reading.progress || isSettled(action.settled, reading, round.island));
  return {
    ...(round.island === undefined ? {} : { island: round.island }),
    inputs: starts ? 0 : after.inputs - before.inputs,
    response: ev.length === 0 ? null : Math.max(...ev.map((e) => e.duration)),
    frames: loaf.map((e) => ({ duration: e.duration, scripts: e.scripts.map((s) => `${s.inv}/${s.fn}`) })),
    ...(round.turnTimes === undefined ? {} : { turn: turnFrames(round.turnTimes, action.budget.frameMs) }),
    // An action with nothing to settle (a hover sweep, idle) has no settled time: its own length is not a wait.
    settled: Object.keys(action.settled).length === 0 ? null : settledAt - start,
    ...(progressAt.length === 0 ? {} : { progressAt: Math.min(...progressAt) - start, progressHeld: held }),
    ipc: await ipc.since(calls),
    // The calls made by the time settled was seen: the page's lag recorder must make none of them (Lag in real use 1.2).
    ipcUntilSettled: await ipc.since(calls, settledCalls),
  };
}

/**
 * Perform each of `actions` for `rounds` rounds on each of `sides` (a build's page: `perform(action)` one round, `mark(label)` its
 * timeline), in turn within each round, so two builds measured together take each round in the same minutes (A, B, A, B, ...:
 * ADR-1001 D3). An action's first round a side cannot perform ends that action, on every side, as NOT RUN on that side. Returns each
 * side's performed actions.
 */
export async function alternate(actions, rounds, sides) {
  const performed = sides.map(() => []);
  for (const action of actions) {
    for (const side of sides) await side.mark(action.name);
    const done = sides.map(() => ({ name: action.name, budget: action.budget, rounds: [] }));
    for (let n = 0; n < rounds && done.every((one) => one.notRun === undefined); n++) {
      for (const [at, side] of sides.entries()) {
        try {
          done[at].rounds.push(await side.perform(action));
        } catch (error) {
          if (!(error instanceof NotRun)) throw error;
          done[at].notRun = error.message;
          break;
        }
      }
    }
    log(action.name, done.map((one) => (one.notRun === undefined ? `${one.rounds.length} rounds` : `NOT RUN: ${one.notRun}`)).join(" | "));
    done.forEach((one, at) => performed[at].push(one));
  }
  for (const side of sides) await side.mark("end");
  return performed;
}

/**
 * Start measuring a ready build's page (`session`: its page, IPC counter and what it read at start): watch its frames and inputs and
 * profile it. Returns the side `alternate` performs rounds on, and `finish(performed)`, which writes its result.json and
 * renderer.cpuprofile into `out`.
 */
async function startMeasuring({ page, ipc, state, readyMs, extra }, { out, size }) {
  await page.waitForTimeout(3000);
  await page.evaluate(OBSERVE);
  await page.addInitScript(ON_START);
  const marks = [];
  const mark = async (label) => marks.push({ label, perf: await page.evaluate("performance.now()"), wall: Date.now() });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const finish = async (performed) => {
    const { profile } = await cdp.send("Profiler.stop");
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "renderer.cpuprofile"), JSON.stringify(profile));
    const ev = await page.evaluate("window.__ev");
    const loaf = await page.evaluate("window.__loaf");
    const mem = await page.evaluate("({ heap: performance.memory?.usedJSHeapSize, nodes: document.getElementsByTagName('*').length })");
    const actions = performed.map((action) => ({ ...action, size }));
    writeFileSync(path.join(out, "result.json"), JSON.stringify({ state, readyMs, size, marks, actions, ev, loaf, ipc: await ipc.all(), mem, ...(await extra()) }, null, 1));
    log("wrote", path.join(out, "result.json"));
  };
  return { side: { mark, perform: (action) => performRound(page, action, ipc) }, finish };
}

/**
 * Run the catalogue on each of `builds` (one, or this checkout's and the one it is compared against), in turn round by round, and
 * write each one's result.json and renderer.cpuprofile into its own `out`. A build is `open(use)`: it starts the app, calls `use`
 * with its ready page, and closes it after.
 */
async function measureBuilds(builds, { actions, rounds, size }) {
  const started = [];
  const run = async (at) => {
    if (at < builds.length) return builds[at].open(async (session) => {
      started.push(await startMeasuring(session, { out: builds[at].out, size }));
      await run(at + 1);
    });
    const performed = await alternate(actions, rounds, started.map((one) => one.side));
    for (const [at, one] of started.entries()) await one.finish(performed[at]);
  };
  await run(0);
}

/** Launch the built desktop app in Electron and call `use` with its ready page; IPC is its main process's handlers, wrapped. */
async function openElectron({ appDir, exe, extraArgs, home: reuse, homeFrom, seeded, project, recorder }, use) {
  const { _electron } = await import("playwright-core");
  const { home, warm } = seeded === undefined ? lagHome({ home: reuse, homeFrom }) : { home: seededHome(seeded), warm: false };
  log("app", appDir, "home", home, seeded !== undefined ? `(the seeded library, project ${project})` : warm ? "(warm: reused)" : homeFrom === "none" ? "(empty)" : `(settings from ${homeFrom})`);

  const began = Date.now();
  const app = await _electron.launch({ executablePath: exe, args: [...extraArgs, appDir, ...(project ? ["--project", project] : [])], env: { ...process.env, STORYTREE_HOME: home, ...(recorder === "off" ? { STORYTREE_LAG_RECORDER: "off" } : {}) }, timeout: 180_000 });
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
    const ipc = { mark: async () => (await read()).length, since: async (from, to) => byChannel((await read()).slice(from, to)), all: read };
    await use({ page, ipc, state, readyMs, extra: async () => ({ lag: await app.evaluate(() => globalThis.__lag), recorder }) });
  } finally {
    await app.close().catch(() => {});
  }
}

/** The page's reads of a snapshot (`snapshot`, the capture kit's seed by name), as the stand-in bridge answers them. */
function snapshotAnswers(kit, snapshot) {
  const { seed, survey } = kit.captureSeed(snapshot);
  let current = seed.projects[0];
  return {
    projectSelection: async () => ({ projects: seed.projects, current }),
    chooseProject: async (name) => ({ projects: seed.projects, current: (current = name) }),
    listProjects: async () => seed.projects,
    projectTree: async () => seed.tree,
    changesSince: async (_, cursor) => (cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor }),
    linesSince: async (_, cursor) => (cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor }),
    frontCovers: async (_, id) => seed.covers[id] ?? [],
    ...(survey === undefined ? {} : { codeSurvey: async () => survey }),
  };
}

/**
 * The page's reads of `project` in the seeded library, as the app's own page reads answer them (@storytree/app's pageReads; the
 * dev loop does not depend on the frame, ADR-0847): the library's and the activity log's answers, the project the only one shown.
 */
async function libraryAnswers({ storytree, project, openActivityLog }) {
  const library = await storytree.openProject(project);
  const log = await openActivityLog(storytree);
  const selection = async () => ({ projects: [project], current: project });
  return {
    answers: {
      projectSelection: selection,
      chooseProject: selection,
      listProjects: async () => [project],
      projectTree: () => library.projectTree(),
      changesSince: (_, cursor) => library.changesSince(cursor),
      linesSince: (_, cursor) => log.since(project, cursor),
      frontCovers: (_, id) => library.frontCovers(id),
      relatedNotes: (_, id) => library.relatedNotes(id),
      arcViews: () => library.arcViews(),
      holds: () => library.holds(),
    },
    close: () => log.close(),
  };
}

/**
 * The library and activity log code of the checkout at `from`: this one's as imported, another's (the build compared against) loaded
 * from its own source through tsx, so its page's reads are answered by its own read code, as its app would answer them.
 */
async function libraryOf(from, url, storytree) {
  if (from === root) return { storytree, openActivityLog };
  const load = (name) => import(pathToFileURL(path.join(from, "packages", name, "src", "index.ts")).href);
  const [library, sessions] = [await load("library"), await load("session-management")];
  return { storytree: await library.connect({ url }), openActivityLog: sessions.openActivityLog };
}

/**
 * Open the desktop page of the checkout at `from` in headless Chromium over its capture kit's stand-in bridge (apps/desktop/src/capture)
 * and call `use` with it ready, answering the page's reads from the seeded library at `url` (`project`), read by that checkout's own
 * library code, or a snapshot (`snapshot`): for a machine where Electron cannot run, as on the Mint box. IPC is the bridge's calls.
 * The kit is the app's own TypeScript, loaded at run time through tsx, as the evidence captures load it: no package depends on it.
 */
async function openChromium({ from = root, snapshot, url, storytree, project, size, out, recorder }, use) {
  const { register } = await import("tsx/esm/api");
  register();
  const kit = await import(pathToFileURL(path.join(from, "apps", "desktop", "src", "capture", "index.ts")).href);
  const library = snapshot === undefined ? await libraryOf(from, url, storytree) : undefined;
  const seeded = library === undefined ? undefined : await libraryAnswers({ ...library, project });
  const recorded = [];
  const answers = {
    ...(seeded?.answers ?? snapshotAnswers(kit, snapshot)),
    // Counted like any call, so a round shows whether the page's lag recorder spoke between an input and its settling; what it
    // sent is kept in result.json beside the lab's own rounds.
    recordLag: async (readings) => { recorded.push(...readings); },
  };
  const dist = path.join(out, "page");
  mkdirSync(out, { recursive: true });
  await kit.buildCapture({ dist });
  const calls = [];
  const counted = (channel, answer) => async (...args) => {
    calls.push({ channel, at: Date.now() });
    return answer(...args);
  };
  const bridge = kit.fakeBridge(Object.fromEntries(Object.entries(answers).map(([channel, answer]) => [channel, counted(channel, answer)])));
  try {
    await kit.withCapture({ folder: path.join(out, "capture"), dist }, async ({ browser, origin }) => {
    const began = Date.now();
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
    await bridge.install(page);
    await page.goto(`${origin}/index.html${recorder === "off" ? "?lag-recorder=off" : ""}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await bridge.ready(page, 180_000);
    const readyMs = Date.now() - began;
    log("state ready after", readyMs, "ms, on", snapshot === undefined ? `the ${size} seed` : `the ${snapshot} snapshot`, from === root ? "" : `(${from})`);
    const ipc = { mark: async () => calls.length, since: async (start, end) => byChannel(calls.slice(start, end)), all: async () => calls };
    await use({ page, ipc, state: "ready", readyMs, extra: async () => ({ lag: [], page: "chromium", ...(snapshot === undefined ? {} : { snapshot }), recorder, recorded, defaulted: bridge.defaulted }) });
    });
  } finally {
    await seeded?.close();
    if (from !== root) await library?.storytree.close();
  }
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
 * and stayed until settled. A turn of the map is judged on its frames alone, the longest of its drag's among them, and keeps their
 * summary: the medians of its rounds' p50 and p95, the longest, and the frames over 50 ms in all. An action with a round it could
 * not perform is NOT RUN, with the reason.
 */
export function judge({ name, size, budget, rounds, notRun }) {
  const sized = size === undefined ? {} : { size };
  if (notRun !== undefined) return { name, ...sized, rounds: rounds.length, notRun };
  const responses = rounds.filter((round) => round.inputs > 0 && round.turn === undefined).map((round) => round.response ?? 0);
  const turns = rounds.flatMap((round) => (round.turn === undefined ? [] : [round.turn]));
  const longest = Math.max(0, ...rounds.flatMap((round) => round.frames.map((frame) => frame.duration)), ...turns.map((turn) => turn.max));
  const settled = rounds.map((round) => round.settled).filter((ms) => ms !== null);
  const ipc = rounds.map((round) => Object.values(round.ipc).reduce((sum, n) => sum + n, 0));
  const settledWithin = (round) => round.settled === null || round.settled <= budget.settledMs || (round.progressAt !== undefined && round.progressAt <= budget.responseMs && round.progressHeld);
  return {
    name, ...sized, rounds: rounds.length,
    response: responses.length === 0 ? undefined : { median: median(responses), worst: Math.max(...responses) },
    longestFrame: longest,
    settled: settled.length === 0 ? undefined : { median: median(settled), worst: Math.max(...settled) },
    ipc: median(ipc),
    ...(turns.length === 0 ? {} : { turn: { p50: median(turns.map((turn) => turn.p50)), p95: median(turns.map((turn) => turn.p95)), max: Math.max(...turns.map((turn) => turn.max)),
      over: turns.reduce((sum, turn) => sum + turn.over, 0) } }),
    verdict: {
      response: responses.length === 0 ? "n/a" : Math.max(...responses) <= budget.responseMs ? "within" : "missed",
      smooth: longest <= budget.frameMs ? "within" : "missed",
      settled: settled.length === 0 ? "n/a" : rounds.every(settledWithin) ? "within" : "missed",
    },
  };
}

/** The table, a row per judged action and the size it ran at: median and worst response, the longest frame, settled, the IPC count, and
 * each verdict; then a line per turn of the map, its frames. */
export function actionTable(rows) {
  const ms = (n) => (n === 0 ? "<16" : n.toFixed(0));
  const lines = [["action", "size", "rounds", "response p50/worst", "longest frame", "settled p50/worst", "IPC", "response", "smooth", "settled"]];
  for (const row of rows) {
    if (row.notRun !== undefined) lines.push([row.name, row.size ?? "-", String(row.rounds), `NOT RUN: ${row.notRun}`]);
    else lines.push([row.name, row.size ?? "-", String(row.rounds), row.response === undefined ? "-" : `${ms(row.response.median)} / ${ms(row.response.worst)} ms`,
      row.longestFrame === 0 ? "none over 50" : `${row.longestFrame.toFixed(0)} ms`, row.settled === undefined ? "-" : `${row.settled.median.toFixed(0)} / ${row.settled.worst.toFixed(0)} ms`,
      String(row.ipc), row.verdict.response, row.verdict.smooth, row.verdict.settled]);
  }
  const widths = lines[0].map((_, column) => Math.max(...lines.filter((line) => line.length > 4).map((line) => line[column].length)));
  const turns = rows.filter((row) => row.turn !== undefined).map(({ name, size, turn }) =>
    `${name}${size === undefined ? "" : ` (${size})`} frames: p50 ${turn.p50.toFixed(0)} / p95 ${turn.p95.toFixed(0)} ms, longest ${turn.max.toFixed(0)} ms, ${turn.over} over 50 ms`);
  return [...lines.map((line) => (line.length > 4 ? line.map((cell, column) => cell.padEnd(widths[column])).join("  ") : `${line.slice(0, 3).map((cell, column) => cell.padEnd(widths[column])).join("  ")}  ${line[3]}`).trimEnd()), ...turns].join("\n");
}

/** 3 when any action could not be performed (NOT RUN), else 0: a missed budget is reported, never a failed run. */
export const exitCode = (rows) => (rows.some((row) => row.notRun !== undefined) ? 3 : 0);

/**
 * How far apart two builds' medians must be before one is called slower or faster (ADR-1001 D3): by more than this share of the
 * quicker build, and by more than three frames. A round's settled time is read once a frame, so two builds in their own browsers can
 * sit a frame apart on every round with nothing between them, two on an action that waits between its inputs: main against itself, in
 * five runs on the busy Mint box, read a Library note 12 ms against 31 ms and Library and back 43 ms against 74 ms.
 */
export const MARGIN = { ratio: 0.2, ms: 50 };

/**
 * The page's background polls, made on timers, not asked for by an action: the library's changes and the log's lines, the project
 * list (every 3 s) and the lag recorder's flush. Their count per round varies by wall time.
 */
const POLL = new Set(["changesSince", "linesSince", "projectSelection", "recordLag"]);

/**
 * What a comparison measures an action by, from its rounds on both builds: a turn of the map by its frames' 95th percentile, else its
 * settled time when it has something to settle, else its response when it made an input, else the time its frames over 50 ms took
 * (ten seconds idle).
 */
function measureOf(rounds) {
  if (rounds.some((round) => round.turn !== undefined)) return { measure: "frame p95", of: (round) => round.turn?.p95 ?? null };
  if (rounds.some((round) => round.settled !== null)) return { measure: "settled", of: (round) => round.settled };
  if (rounds.some((round) => round.inputs > 0)) return { measure: "response", of: (round) => round.response ?? 0 };
  return { measure: "frames", of: (round) => round.frames.reduce((sum, frame) => sum + frame.duration, 0) };
}

/** Each channel's median calls per round, the background poll left out, channels named without their `storytree:` prefix. */
function readsPerRound(rounds) {
  const name = (channel) => channel.replace(/^storytree:/, "");
  const channels = new Set(rounds.flatMap((round) => Object.keys(round.ipc).map(name)));
  const counts = {};
  for (const channel of [...channels].filter((channel) => !POLL.has(channel))) {
    counts[channel] = median(rounds.map((round) => Object.entries(round.ipc).filter(([called]) => name(called) === channel).reduce((sum, [, n]) => sum + n, 0)));
  }
  return counts;
}

/**
 * One action compared on two builds measured together: `ours` (this checkout's rounds) against `theirs` (the build it is compared
 * against). Both medians of its measure, the difference, and a verdict: slower when this build's median is worse by more than
 * MARGIN's share of the other's and by more than its milliseconds, faster when better by more than MARGIN's share of its own and its milliseconds,
 * otherwise the same. A read the action asks for a different
 * number of times per round is listed in `counts`. A side that could not perform it makes the row NOT RUN, naming that side.
 */
export function compareAction(ours, theirs) {
  const sized = ours.size === undefined ? {} : { size: ours.size };
  const rounds = Math.min(ours.rounds.length, theirs.rounds.length);
  const notRun = ours.notRun !== undefined ? `this build: ${ours.notRun}` : theirs.notRun !== undefined ? `against: ${theirs.notRun}` : undefined;
  if (notRun !== undefined) return { name: ours.name, ...sized, rounds, notRun };
  const { measure, of } = measureOf([...ours.rounds, ...theirs.rounds]);
  const valuesOf = (performed) => performed.map(of).filter((value) => value !== null);
  const [against, mine] = [median(valuesOf(theirs.rounds)), median(valuesOf(ours.rounds))];
  const difference = mine - against;
  // Each way against the quicker build, so a pair compared either way round reads as mirror images.
  const past = (by, quicker) => by > MARGIN.ms && by > quicker * MARGIN.ratio;
  const [theirReads, ourReads] = [readsPerRound(theirs.rounds), readsPerRound(ours.rounds)];
  const counts = [...new Set([...Object.keys(theirReads), ...Object.keys(ourReads)])].sort()
    .map((channel) => ({ channel, against: theirReads[channel] ?? 0, this: ourReads[channel] ?? 0 }))
    .filter((count) => count.against !== count.this);
  return { name: ours.name, ...sized, rounds, measure, against, this: mine, difference, verdict: past(difference, against) ? "slower" : past(-difference, mine) ? "faster" : "same", counts };
}

/** The comparison's table, a row per action and size, then a line per read whose count per round differs between the builds. */
export function compareTable(rows) {
  const signed = (n) => `${n < 0 ? "-" : "+"}${Math.abs(n).toFixed(0)}`;
  const lines = [["action", "size", "rounds", "measure", "against p50", "this p50", "difference", "verdict"]];
  for (const row of rows) {
    if (row.notRun !== undefined) lines.push([row.name, row.size ?? "-", String(row.rounds), `NOT RUN: ${row.notRun}`]);
    else lines.push([row.name, row.size ?? "-", String(row.rounds), row.measure, `${row.against.toFixed(0)} ms`, `${row.this.toFixed(0)} ms`,
      `${signed(row.difference)} ms (${row.against === 0 ? "-" : `${signed((100 * row.difference) / row.against)}%`})`, row.verdict]);
  }
  const widths = lines[0].map((_, column) => Math.max(...lines.filter((line) => line.length > 4).map((line) => line[column].length)));
  const table = lines.map((line) => (line.length > 4 ? line.map((cell, column) => cell.padEnd(widths[column])).join("  ") : `${line.slice(0, 3).map((cell, column) => cell.padEnd(widths[column])).join("  ")}  ${line[3]}`).trimEnd());
  const counts = rows.flatMap((row) => (row.counts ?? []).map((count) => `count: ${row.name}${row.size === undefined ? "" : ` (${row.size})`} ${count.channel} ${count.against} -> ${count.this} per round`));
  return [...table, ...counts].join("\n");
}

/**
 * Call `use` with the desktop app folder of the build to compare against. `against` is a built app folder (an apps/desktop, as
 * APP_DIR names), used where it is; otherwise a git ref of the repository at `root`, checked out into a throwaway worktree, installed
 * with the repository's own provisioning (`install`), built by `build` when given, and removed afterwards, whatever happened.
 */
export async function withAgainst(against, { root: repo = root, install = (tree) => provision({ root: tree, log }), build }, use) {
  if (existsSync(against) && statSync(against).isDirectory()) return use(path.resolve(against));
  const folder = mkdtempSync(path.join(tmpdir(), "lag-against-"));
  const tree = path.join(folder, "checkout");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("worktree", "add", "--detach", tree, against);
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw new Error(`--against ${against} is neither a folder nor a ref git can check out: ${String(error.stderr ?? error.message).trim()}`);
  }
  try {
    log("against", against, "checked out in", tree);
    const installed = install(tree);
    if (!installed.ok) throw new Error(`could not install ${against} in ${tree} (exit ${installed.code})`);
    await build?.(tree);
    return await use(path.join(tree, "apps", "desktop"));
  } finally {
    try {
      git("worktree", "remove", "--force", tree);
    } catch {}
    rmSync(folder, { recursive: true, force: true });
    try {
      git("worktree", "prune");
    } catch {}
  }
}

/** The runs a seeded run in `out` kept, a folder per size, smallest first. */
function sizeRuns(out) {
  return Object.keys(SIZES).filter((size) => existsSync(path.join(out, size, "result.json"))).map((size) => path.join(out, size));
}

/** The actions a run's result.json in `dir` recorded. */
const actionsIn = (dir) => JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8")).actions ?? [];

/** Every judged row of the run in `out`: its actions, or each size's on a seeded run. */
function judgedRows(out) {
  const results = existsSync(path.join(out, "result.json")) ? [out] : sizeRuns(out);
  return results.flatMap((dir) => actionsIn(dir).map(judge));
}

/** The sizes a comparison in `out` kept, smallest first: a folder per size holding this build's run (this) and the other's (against). */
function comparedRuns(out) {
  return Object.keys(SIZES).map((size) => path.join(out, size)).filter((dir) => ["this", "against"].every((side) => existsSync(path.join(dir, side, "result.json"))));
}

/** Every compared row of the comparison in `out`, a row per action and size. */
export function comparedRows(out) {
  return comparedRuns(out).flatMap((dir) => {
    const theirs = actionsIn(path.join(dir, "against"));
    return actionsIn(path.join(dir, "this")).map((ours) => compareAction(ours, theirs.find((one) => one.name === ours.name) ?? { ...ours, rounds: [], notRun: "not measured" }));
  });
}

/** The rows a run in `out` is judged by for its exit code: the comparison's, or the budgets'. */
const runRows = (out) => (comparedRuns(out).length > 0 ? comparedRows(out) : judgedRows(out));

/**
 * The summary of the run in `out`. A comparison (--against) kept a folder per size and build: the comparison's table, then each build's
 * actions against their budgets. A seeded run kept a folder per size: one table across the sizes, then each size's summary.
 * One run's: the actions' table, IPC by channel, each action's cost over its rounds, events, long frames, main-process lag and the profile's top functions. */
export function summary(out) {
  const compared = existsSync(path.join(out, "result.json")) ? [] : comparedRuns(out);
  if (compared.length > 0) {
    // A comparison: its verdicts, then each build's actions against their budgets; --analyze <out>/<size>/<this|against> gives one in full.
    return [`${compareTable(comparedRows(out))}\n`, ...compared.flatMap((dir) => ["this", "against"].map((side) => `== ${path.basename(dir)}: ${side} ==\n${actionTable(actionsIn(path.join(dir, side)).map(judge))}\n`))].join("\n");
  }
  if (!existsSync(path.join(out, "result.json"))) {
    const runs = sizeRuns(out);
    if (runs.length === 0) throw new Error(`${out} holds no run: no result.json, in it or in a folder per size`);
    return [`${actionTable(judgedRows(out))}\n`, ...runs.map((dir) => `== ${path.basename(dir)} ==\n${summary(dir)}`)].join("\n");
  }
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
  const names = named?.split(",");
  const unknown = names?.filter((name) => !catalogue.some((action) => action.name === name)) ?? [];
  if (unknown.length > 0) throw new Error(`no action ${unknown.join(", ")} in the catalogue: ${CATALOGUE.map((action) => action.name).join(", ")}`);
  const actions = catalogue.filter((action) => names === undefined || names.includes(action.name));
  const rounds = Number(option(args, "rounds", "5"));
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error("--rounds takes a whole number of at least 1");
  const out = path.resolve(option(args, "out", path.join(tmpdir(), `lag-desktop-${new Date().toISOString().replace(/[:.]/g, "-")}`)));
  mkdirSync(out, { recursive: true });
  const chromium = args.includes("--chromium");
  const live = args.includes("--live");
  const snapshot = option(args, "snapshot", undefined);
  const against = option(args, "against", undefined);
  if (live && chromium) throw new Error("--live reads the real library through the desktop app; --chromium reads the seeded library, or a --snapshot");
  if (snapshot !== undefined && !chromium) throw new Error("--snapshot is a --chromium run's");
  if (against !== undefined && (live || snapshot !== undefined)) throw new Error("--against compares two builds on the seeded library, not with --live or --snapshot");
  const recorder = option(args, "recorder", "on");
  if (recorder !== "on" && recorder !== "off") throw new Error("--recorder takes on or off");
  const sizes = option(args, "sizes", Object.keys(SIZES).join(",")).split(",");
  for (const size of sizes) seedSize(size);
  const electron = (appDir) => {
    if (!existsSync(path.join(appDir, "dist", "main.cjs"))) throw new Error(`${appDir} has no dist/main.cjs: build it first (pnpm --filter @storytree/desktop build), or set APP_DIR to a built app`);
    const exe = process.env.ELECTRON_EXE ?? createRequire(path.join(appDir, "package.json"))("electron");
    return { appDir, exe, extraArgs: (process.env.ELECTRON_ARGS ?? "").split(" ").filter(Boolean) };
  };
  const ourApp = path.resolve(process.env.APP_DIR ?? path.join(root, "apps", "desktop"));
  // The whole run, a compared build's checkout and install included, waits its turn behind gate and test runs (ADR-1001 D3).
  const release = await acquireHeavyLock({ root, what: "pnpm lag:desktop" });
  try {
    if (snapshot !== undefined) await measureBuilds([{ out, open: (use) => openChromium({ snapshot, size: snapshot, out, recorder }, use) }], { actions, rounds, size: snapshot });
    else if (live) {
      const homeFrom = option(args, "home-from", process.env.STORYTREE_HOME ?? path.join(homedir(), ".storytree", "0.3"));
      const home = option(args, "home", undefined);
      const opened = { ...electron(ourApp), home: home === undefined ? undefined : path.resolve(home), homeFrom, project: option(args, "project", undefined), recorder };
      await measureBuilds([{ out, open: (use) => openElectron(opened, use) }], { actions, rounds, size: "live" });
    } else {
      // A build of the seeded library: this checkout's, or the one compared against (`appDir`, an apps/desktop, in its checkout).
      const build = (appDir, dir, seeded) => (chromium
        ? { out: dir, open: (use) => openChromium({ from: path.resolve(appDir, "..", ".."), ...seeded, out: dir, recorder }, use) }
        : { out: dir, open: (use) => openElectron({ ...electron(appDir), seeded: seeded.url, project: seeded.project, recorder }, use) });
      const measure = (theirApp) => withSeededLibrary(sizes, async ({ url, storytree, projects }) => {
        for (const size of sizes) {
          const sized = path.join(out, size);
          const seeded = { url, storytree, project: projects[size], size };
          log(size, "seed:", describeSize(size));
          const builds = theirApp === undefined ? [build(ourApp, sized, seeded)] : [build(ourApp, path.join(sized, "this"), seeded), build(theirApp, path.join(sized, "against"), seeded)];
          await measureBuilds(builds, { actions, rounds, size });
        }
      });
      if (against === undefined) await measure(undefined);
      else {
        if (!chromium) electron(ourApp);
        const buildDesktop = (tree) => execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@storytree/desktop", "build"], { cwd: tree, stdio: "inherit", shell: process.platform === "win32" });
        await withAgainst(against, { build: chromium ? undefined : buildDesktop }, measure);
      }
    }
  } finally {
    release();
  }
  console.log(`\n${summary(out)}`);
  console.log(`\nlag:desktop: the run is in ${out}`);
  return exitCode(runRows(out));
}

/**
 * Seed each of `sizes` as its own project (lag-<size>) in a throwaway Postgres, STORYTREE_TEST_PG_URL's when set, otherwise one
 * started in a temporary folder, and run `measure` on it; the projects are dropped and the server stopped after.
 */
async function withSeededLibrary(sizes, measure) {
  let server;
  let folder;
  let url = process.env.STORYTREE_TEST_PG_URL;
  if (!url) {
    folder = mkdtempSync(path.join(tmpdir(), "lag-desktop-pg-"));
    server = await start({ dataDir: path.join(folder, "pgdata"), owner: "a `pnpm lag:desktop` run" });
    url = server.url;
  }
  const storytree = await connect({ url });
  const projects = Object.fromEntries(sizes.map((size) => [size, `lag-${size}`]));
  try {
    for (const size of sizes) {
      await storytree.dropProject(projects[size]).catch(() => {});
      const began = Date.now();
      await seedLagProject(storytree, url, projects[size], size);
      log("seeded", size, "in", Date.now() - began, "ms");
    }
    await measure({ url, storytree, projects });
  } finally {
    for (const project of Object.values(projects)) await storytree.dropProject(project).catch(() => {});
    await storytree.close();
    await server?.stop();
    if (folder) rmSync(folder, { recursive: true, force: true });
  }
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
