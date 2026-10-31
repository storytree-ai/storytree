// Capability 8 · Lag instruments. `pnpm lag:box`: the Mint box measures main after merges (ADR-1001 D3) and names the pull request
// that slowed an action. A systemd user timer (`pnpm lag:box install`) starts a tick every 15 minutes; a tick that finds main has
// moved past the last commit measured, and no run going, compares the newest main with each action's baseline through
// `pnpm lag:desktop --chromium --against` (desktop-lag.mjs), in a checkout of its own. One run at a time, always the newest main,
// the merges in between skipped, so its cost does not grow with the number of landings and no pull request waits on it. A timer,
// not a step of the PR watcher (lanes/watch.mjs): the watcher's turn is short and model-free per pull request, a lag run takes
// minutes behind the heavy-run lock, and polling main is all the coalescing needs.
//
// - Each action keeps a baseline: the last commit at which it was within the margin. A slower verdict asks for a second run; the
//   slowdown counts only when that one agrees, and the baseline does not move over it. `pnpm lag:box rebaseline <action> --reason …`
//   moves it, the reason kept.
// - A slowdown that reproduced is halved down to the merge between its baseline and where it was seen, naming the pull request.
// - The history is kept in the library's server, in a database of its own (storytree-lag), so `pnpm lag:box` reads it from any
//   machine whose library setting names the box.
// - Each catalogue entry names the budget contract its action answers to on the capability that owns it; after each measuring
//   run the runner writes that contract's VERIFIED verdict as a lag run (ADR-1001 D5, the shape of an acceptance run's,
//   ADR-0825 D5), so a slowdown that reproduced makes the capability read not healthy and reaches the health worklist.
// - A run is bounded (--limit-minutes, default 30, the heavy-run lock's queue included): one that passes it is stopped and recorded
//   NOT RUN, its heavy-run lock released.
// It is no GitHub workflow, nothing of it runs in CI, and no pull request's check reads it.
//
//   pnpm lag:box                                      each action's baseline, last runs and any standing slowdown
//   pnpm lag:box rebaseline <action> --reason <why> [--at <commit>]
//   pnpm lag:box tick [--limit-minutes <n>]           what the timer runs: decide, run, record
//   pnpm lag:box install [--dry-run]                  the box's checkouts and its systemd user timer
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOGUE } from "@storytree/forest/actions";
import { connect } from "@storytree/library";
import { locateLibrary, storytreeHome } from "@storytree/project-and-caller";

import { comparedRows } from "./desktop-lag.mjs";
import { clearAbandonedHeavyLock } from "./heavy-lock.mjs";
import { recordHealth } from "@storytree/ci-health";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PROJECT = "storytree";
export const LAG_DATABASE = "storytree-lag";
const BOX = path.join(homedir(), "storytree-lanes", "lag-box");
const LIMIT_MINUTES = 30;

const log = (...parts) => console.log(new Date().toISOString().slice(0, 19), ...parts);
const short = (commit) => (commit ?? "-").slice(0, 8);

/** An action's verdict in one run: slower when any size read slower, within when the rest measured, none when nothing did. */
function verdictOf(run, action) {
  const rows = (run.rows ?? []).filter((row) => row.name === action && row.notRun === undefined);
  if (rows.length === 0) return undefined;
  return rows.some((row) => row.verdict === "slower") ? "slower" : "within";
}

/** Whether only the build compared against could not perform the action in a run: an action that merge added, its parent lacking it. */
function newTo(run, action) {
  const rows = (run.rows ?? []).filter((row) => row.name === action);
  return rows.length > 0 && rows.every((row) => row.notRun?.startsWith("against: "));
}

const asks = (run, action) => run.actions === null || run.actions === undefined || run.actions.includes(action);

/**
 * Each catalogue action's standing, replayed from the history (oldest first): its baseline, a suspect (one slower run waiting for a
 * second), a slowdown (two agreeing runs; lo and hi bound the merges being halved, culprit and pr once named), its last re-baseline.
 */
export function actionStates({ history, actions, log: mainLog }) {
  const states = {};
  for (const action of actions) {
    const state = { baseline: undefined, suspect: undefined, slowdown: undefined, rebaselined: undefined, runs: [] };
    for (const run of history) {
      if (!asks(run, action)) continue;
      if (run.purpose === "rebaseline") {
        Object.assign(state, { baseline: run.head, suspect: undefined, slowdown: undefined, rebaselined: { head: run.head, reason: run.reason } });
        continue;
      }
      if (run.state !== "done") continue;
      const verdict = verdictOf(run, action);
      if (verdict === undefined) continue;
      state.runs.push({ ...run, verdict });
      if (run.purpose === "bisect") {
        const halving = state.slowdown;
        if (halving !== undefined && halving.culprit === undefined && run.against === halving.baseline) {
          if (verdict === "slower") halving.hi = run.head;
          else halving.lo = run.head;
        }
        continue;
      }
      if (state.baseline !== undefined && run.against !== state.baseline) continue; // measured against something no longer its baseline
      if (verdict === "within") {
        Object.assign(state, { baseline: run.head, suspect: undefined, slowdown: undefined });
      } else if (state.slowdown !== undefined) {
        state.slowdown.latest = run.head;
      } else if (state.suspect !== undefined) {
        state.slowdown = { baseline: run.against, at: run.head, lo: run.against, hi: state.suspect, culprit: undefined };
        state.suspect = undefined;
      } else {
        state.baseline = run.against;
        state.suspect = run.head;
      }
    }
    if (state.slowdown !== undefined) {
      const between = mergesBetween(mainLog, state.slowdown.lo, state.slowdown.hi);
      if (between.length === 0) {
        state.slowdown.culprit = state.slowdown.hi;
        state.slowdown.pr = pullRequestOf(mainLog.find((entry) => entry.commit === state.slowdown.hi)?.subject);
      } else state.slowdown.between = between;
    }
    states[action] = state;
  }
  return states;
}

/** The first-parent commits of main strictly after `lo` and before `hi`, oldest first. */
function mergesBetween(mainLog, lo, hi) {
  const from = mainLog.findIndex((entry) => entry.commit === lo);
  const to = mainLog.findIndex((entry) => entry.commit === hi);
  if (to === -1) return [];
  return mainLog.slice(from + 1, to).map((entry) => entry.commit);
}

/** The pull request a merge commit's subject names: GitHub's "Merge pull request #N from …". */
export function pullRequestOf(subject) {
  const found = /^Merge pull request #(\d+)/.exec(subject ?? "");
  return found === null ? undefined : Number(found[1]);
}

/** Comparisons grouped: one per (purpose, head, against), naming its actions, or null when it is every action. */
function grouped(asked, everyAction) {
  const groups = new Map();
  for (const { purpose, head, against, action } of asked) {
    const key = `${purpose} ${head} ${against}`;
    if (!groups.has(key)) groups.set(key, { purpose, head, against, actions: [] });
    groups.get(key).actions.push(action);
  }
  return [...groups.values()].map((group) => ({ ...group, actions: group.actions.length === everyAction.length ? null : group.actions }));
}

/**
 * What the runner does next, given the history (oldest first), main's newest commit and its first parent, the catalogue's actions and
 * main's first-parent log (oldest first, with subjects): nothing while a run is going; else halve a slowdown not yet named; else give a
 * slower verdict its second run; else, once main has moved past the last commit measured, measure the newest main against each
 * action's baseline (main's parent for an action with none yet).
 */
export function decide({ history, main, actions, log: mainLog }) {
  if (history.some((run) => run.state === "running")) return { why: "a run is going", comparisons: [] };
  const states = actionStates({ history, actions, log: mainLog });
  const halving = actions.filter((action) => states[action].slowdown?.between !== undefined).map((action) => {
    const { baseline, between } = states[action].slowdown;
    return { purpose: "bisect", head: between[Math.floor((between.length - 1) / 2)], against: baseline, action };
  });
  if (halving.length > 0) return { why: "halving the merges behind a slowdown", comparisons: grouped(halving, []) };
  const suspects = actions.filter((action) => states[action].suspect !== undefined).map((action) => ({ purpose: "confirm", head: main.commit, against: states[action].baseline, action }));
  if (suspects.length > 0) return { why: "a slower verdict waits for a second run", comparisons: grouped(suspects, []) };
  const measured = history.filter((run) => run.purpose === "measure" || run.purpose === "confirm").at(-1);
  if (measured?.head === main.commit) return { why: `main (${short(main.commit)}) is measured`, comparisons: [] };
  const asked = actions.map((action) => ({ purpose: "measure", head: main.commit, against: states[action].baseline ?? main.parent, action }));
  return { why: `main moved to ${short(main.commit)}`, comparisons: grouped(asked, actions) };
}

/** Who writes a budget contract's verified health: the box's lag run, from what it measured. */
export const LAG_RUN = "lag run";

/**
 * Each budget contract's verdict after the runs `ran` (their seqs), from the history (oldest first) they are now part of; `owners`
 * maps an action to its contract. Only a measuring run (measure or confirm) mints, and only for the contracts of the actions it asked:
 * failing for a slowdown that reproduced, which a run that did not happen leaves standing; NOT RUN for an action it asked and did not
 * measure; passing for an action within the margin of its baseline. A contract fails if any of its actions does; one with an action whose slower verdict waits for its second run, or
 * that was never measured, or that only the build it was compared against could not perform before it had a baseline (an action the
 * merge added), gets nothing, so its standing verdict holds; one with an action not run is not checked.
 * @returns {Map<string, { number: string, state: "passing" | "failing" | "not-checked", note?: string, reason?: string, skip?: "other" }>}
 */
export function lagVerdicts({ history, actions, log: mainLog, owners, ran }) {
  const runs = history.filter((run) => ran.includes(run.seq) && (run.purpose === "measure" || run.purpose === "confirm"));
  const states = actionStates({ history, actions, log: mainLog });
  const standing = (action) => {
    const { baseline, suspect, slowdown } = states[action];
    if (slowdown !== undefined) {
      const named = slowdown.culprit === undefined ? "" : `, ${slowdown.pr === undefined ? `commit ${short(slowdown.culprit)}` : `pull request #${slowdown.pr}`}`;
      return { state: "failing", why: `${action} slower since ${short(slowdown.at)} against its baseline ${short(slowdown.baseline)}${named}` };
    }
    const run = runs.filter((one) => asks(one, action)).at(-1);
    if (baseline === undefined && run?.state === "done" && newTo(run, action)) return { state: "waiting" };
    if (run !== undefined && (run.state !== "done" || verdictOf(run, action) === undefined)) {
      return { state: "not-run", why: run.state === "done" ? `${action} could not be performed` : run.reason ?? "the run did not finish" };
    }
    if (suspect !== undefined || baseline === undefined) return { state: "waiting" };
    return { state: "passing", why: `${action} within the margin of its baseline ${short(baseline)}` };
  };
  const verdicts = new Map();
  for (const contract of new Set(actions.map((action) => owners[action]).filter(Boolean))) {
    const own = actions.filter((action) => owners[action] === contract);
    if (!own.some((action) => runs.some((run) => asks(run, action)))) continue;
    const each = own.map(standing);
    const said = (state) => each.filter((one) => one.state === state).map(({ why }) => why).join("; ");
    if (each.some(({ state }) => state === "failing")) verdicts.set(contract, { number: contract, state: "failing", note: said("failing") });
    else if (each.some(({ state }) => state === "waiting")) continue;
    else if (each.some(({ state }) => state === "not-run")) verdicts.set(contract, { number: contract, state: "not-checked", skip: "other", reason: `NOT RUN: ${said("not-run")}` });
    else verdicts.set(contract, { number: contract, state: "passing", note: said("passing") });
  }
  return verdicts;
}

/**
 * Write each of `verdicts` (by contract id) to its contract's verified column as a lag run, with the commit measured and the evidence
 * in the note; a not-checked one is written as not re-run over the verdict it did not reproduce (CI health's recordHealth).
 * @param {import("@storytree/library").Library} library
 */
export function recordLagVerdicts(library, verdicts, { commit, evidence }) {
  const withEvidence = new Map([...verdicts].map(([contract, verdict]) => [contract, verdict.note === undefined ? verdict : { ...verdict, note: `${verdict.note}, evidence ${evidence}` }]));
  return recordHealth(library, new Map([...verdicts.keys()].map((contract) => [contract, contract])), withEvidence, { by: LAG_RUN, source: "local", commit });
}

/** The printed reading: per action, its baseline and standing, then its last runs. */
export function statusText({ history, actions, log: mainLog, last = 3 }) {
  const states = actionStates({ history, actions, log: mainLog });
  const width = Math.max(...actions.map((action) => action.length));
  const lines = [];
  for (const action of actions) {
    const state = states[action];
    const { slowdown } = state;
    const standing = slowdown !== undefined
      ? `SLOWER since ${short(slowdown.at)}: ${slowdown.culprit === undefined ? `halving ${slowdown.between.length} merge(s) after ${short(slowdown.lo)}` : `${slowdown.pr === undefined ? "commit" : `pull request #${slowdown.pr}`} (${short(slowdown.culprit)})`}`
      : state.suspect !== undefined ? `slower once at ${short(state.suspect)}, waiting for a second run`
      : state.rebaselined !== undefined && state.rebaselined.head === state.baseline && !state.runs.some((run) => run.against === state.baseline) ? `re-baselined at ${short(state.rebaselined.head)}: ${state.rebaselined.reason}`
      : state.baseline === undefined ? "not measured yet" : "within the margin";
    lines.push(`${action.padEnd(width)}  baseline ${short(state.baseline)}  ${standing}`);
    for (const run of state.runs.slice(-last)) {
      const row = (run.rows ?? []).filter((one) => one.name === action && one.notRun === undefined).map((one) => `${one.size ?? "-"} ${Math.round(one.against)} -> ${Math.round(one.this)} ms`).join(", ");
      lines.push(`  ${String(run.ended ?? run.started ?? "").slice(0, 16)}  ${short(run.head)} against ${short(run.against)}  ${run.purpose.padEnd(7)}  ${run.verdict === "within" ? "same" : run.verdict}  ${row}`);
    }
  }
  const notRun = history.filter((run) => run.state === "not-run").slice(-last);
  for (const run of notRun) lines.push(`NOT RUN ${String(run.started ?? "").slice(0, 16)}  ${short(run.head)} against ${short(run.against)}: ${run.reason}`);
  return lines.join("\n");
}

/** The history's tables, idempotent, applied once per connection (ADR-0973); later changes are appended. */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS lag_runs (
    seq        bigserial PRIMARY KEY,
    project    text NOT NULL,
    purpose    text NOT NULL CHECK (purpose IN ('measure', 'confirm', 'bisect', 'rebaseline')),
    head       text NOT NULL,
    against    text,
    actions    jsonb,
    state      text NOT NULL CHECK (state IN ('running', 'done', 'not-run')),
    reason     text,
    rows       jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS lag_runs_project_idx ON lag_runs (project, seq)`,
];

/** The lag history of `project`, in its own database on `storytree`'s server: a project reads only its own runs. */
export async function openHistory(storytree, project = PROJECT) {
  const pool = await storytree.ownDatabase(LAG_DATABASE, { tables: SCHEMA, declaredIn: [import.meta.url] });
  const json = (value) => (value === null || value === undefined ? null : JSON.stringify(value));
  return {
    async read() {
      const { rows } = await pool.query("SELECT * FROM lag_runs WHERE project = $1 ORDER BY seq", [project]);
      return rows.map((row) => ({ seq: Number(row.seq), purpose: row.purpose, head: row.head, against: row.against, actions: row.actions, state: row.state, reason: row.reason ?? undefined, rows: row.rows ?? undefined, started: row.started_at?.toISOString(), ended: row.ended_at?.toISOString() }));
    },
    async start({ purpose, head, against, actions }) {
      const { rows } = await pool.query("INSERT INTO lag_runs (project, purpose, head, against, actions, state) VALUES ($1, $2, $3, $4, $5, 'running') RETURNING seq", [project, purpose, head, against, json(actions)]);
      return Number(rows[0].seq);
    },
    async finish(seq, { state, reason, rows }) {
      await pool.query("UPDATE lag_runs SET state = $2, reason = $3, rows = $4, ended_at = now() WHERE project = $1 AND seq = $5", [project, state, reason ?? null, json(rows), seq]);
    },
    async rebaseline({ action, head, reason }) {
      await pool.query("INSERT INTO lag_runs (project, purpose, head, actions, state, reason, ended_at) VALUES ($1, 'rebaseline', $2, $3, 'done', $4, now())", [project, head, json([action]), reason]);
    },
    /** Runs left `running` by a tick that ended before it finished them: none is going while this one holds the box's run lock. */
    async abandon() {
      await pool.query("UPDATE lag_runs SET state = 'not-run', reason = 'the runner stopped before it finished', ended_at = now() WHERE project = $1 AND state = 'running'", [project]);
    },
    async forget() {
      await pool.query("DELETE FROM lag_runs WHERE project = $1", [project]);
    },
  };
}

const minutes = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(ms % 60_000 === 0 ? 0 : 1)} min` : `${Math.round(ms / 1000)} s`);

/**
 * Run `command` in a process group of its own, stopped when it passes `limitMs`: SIGTERM to the group (the heavy-run lock's wrapper
 * then stops its command and releases the lock), SIGKILL after `graceMs`; on Windows, taskkill /t /f at once, after which a lock its
 * killed wrapper could not release is cleared. Resolves to its exit code, or timedOut with the reason.
 * `setTimer` is setTimeout unless a caller fires the limit itself.
 */
export function runBounded(command, args, { cwd, env = process.env, limitMs, graceMs = 30_000, log: say = log, output = "inherit", setTimer = setTimeout }) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", output, output], detached: !windows });
    let timedOut = false;
    let killer;
    const signal = (sent) => {
      try {
        if (windows) execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        else process.kill(-child.pid, sent);
      } catch {}
    };
    const timer = setTimer(() => {
      timedOut = true;
      say(`lag:box: the run passed its limit of ${minutes(limitMs)}; stopping it`);
      signal("SIGTERM");
      killer = setTimer(() => signal("SIGKILL"), graceMs);
    }, limitMs);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killer);
      if (timedOut) clearAbandonedHeavyLock(env.STORYTREE_HOME);
      resolve(timedOut ? { timedOut, code, reason: `passed its limit of ${minutes(limitMs)}` } : { timedOut, code });
    });
  });
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** main's newest commit, its first parent and its first-parent log (oldest first, with subjects), freshly fetched. */
function readMain(repo) {
  git(repo, "fetch", "-q", "origin", "main");
  const commit = git(repo, "rev-parse", "origin/main");
  const lines = git(repo, "log", "--first-parent", "-n", "2000", "--format=%H%x09%s", "origin/main").split("\n").filter(Boolean).reverse();
  return { main: { commit, parent: git(repo, "rev-parse", "origin/main^1") }, log: lines.map((line) => ({ commit: line.split("\t")[0], subject: line.split("\t").slice(1).join("\t") })) };
}

/** The box's own run lock: only one tick decides and runs at a time, whoever started it. Undefined when another holds it. */
function takeRunLock() {
  const file = path.join(storytreeHome(), "lag-box.lock");
  mkdirSync(path.dirname(file), { recursive: true });
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }), { flag: "wx" });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let holder;
      try {
        holder = JSON.parse(readFileSync(file, "utf8"));
        process.kill(holder.pid, 0);
        return undefined;
      } catch {
        rmSync(file, { force: true }); // its holder is gone
      }
    }
  }
  return undefined;
}

/** Measure one comparison in the box's measuring checkout: `head` checked out and installed, then lag:desktop --against `against`. */
async function measure(comparison, { checkout, limitMs }) {
  git(checkout, "fetch", "-q", "origin", "main");
  git(checkout, "checkout", "-q", "--detach", comparison.head);
  execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: checkout, stdio: "inherit" });
  const out = mkdtempSync(path.join(tmpdir(), "lag-box-"));
  const actions = comparison.actions === null ? [] : ["--action", comparison.actions.join(",")];
  const command = ["--import", "tsx", "packages/dev-loop/src/desktop-lag.mjs", "--chromium", "--against", comparison.against, ...actions, "--out", out];
  const began = Date.now();
  const ran = await runBounded(process.execPath, [path.join(checkout, "packages", "dev-loop", "src", "heavy-lock.mjs"), "--", process.execPath, ...command], { cwd: checkout, limitMs });
  const took = minutes(Date.now() - began);
  try {
    if (ran.timedOut) return { state: "not-run", reason: `${ran.reason} (the heavy-run lock's queue included)` };
    const rows = comparedRows(out);
    if (rows.length === 0) return { state: "not-run", reason: `lag:desktop exited ${ran.code} with no comparison, after ${took}` };
    return { state: "done", rows, reason: `took ${took}` };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

async function withHistory(use) {
  const library = locateLibrary();
  if (!library.found) throw new Error(library.message);
  const storytree = await connect(library.connect);
  try {
    return await use(await openHistory(storytree), storytree);
  } finally {
    await storytree.close();
  }
}

const ACTIONS = CATALOGUE.map((action) => action.name);
const OWNERS = Object.fromEntries(CATALOGUE.map((action) => [action.name, action.owner.contract]));

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

async function tick(args) {
  const release = takeRunLock();
  if (release === undefined) return log("lag:box: another tick is running");
  try {
    const checkout = path.join(BOX, "measure");
    if (!existsSync(checkout)) throw new Error(`no measuring checkout at ${checkout}: run pnpm lag:box install`);
    const limitMs = Number(option(args, "limit-minutes", LIMIT_MINUTES)) * 60_000;
    await withHistory(async (history, storytree) => {
      await history.abandon();
      const { main, log: mainLog } = readMain(checkout);
      const next = decide({ history: await history.read(), main, actions: ACTIONS, log: mainLog });
      log(`lag:box: ${next.why}`);
      const ran = [];
      for (const comparison of next.comparisons) {
        const seq = await history.start(comparison);
        ran.push(seq);
        log(`lag:box: ${comparison.purpose} ${short(comparison.head)} against ${short(comparison.against)}${comparison.actions === null ? "" : ` (${comparison.actions.join(", ")})`}`);
        let result;
        try {
          result = await measure(comparison, { checkout, limitMs });
        } catch (error) {
          result = { state: "not-run", reason: error.message.split("\n")[0] };
        }
        await history.finish(seq, result);
        log(`lag:box: ${result.state}${result.reason === undefined ? "" : `: ${result.reason}`}`);
      }
      if (next.comparisons.length === 0) return;
      const runs = await history.read();
      console.log(statusText({ history: runs, actions: ACTIONS, log: mainLog }));
      const verdicts = lagVerdicts({ history: runs, actions: ACTIONS, log: mainLog, owners: OWNERS, ran });
      if (verdicts.size === 0) return;
      const library = await storytree.openProject(PROJECT);
      try {
        const written = await recordLagVerdicts(library, verdicts, { commit: main.commit, evidence: `pnpm lag:box, run ${ran.join(", ")}` });
        log(`lag:box: recorded as a lag run: ${written.passing} passing, ${written.failing} failing, ${written.marked} not re-run`);
      } finally {
        await library.close();
      }
    });
  } finally {
    release();
  }
}

/** The box's two checkouts (runner: the timer's code, kept at main; measure: the commit being measured) and its systemd user timer. */
function install(args) {
  const dry = args.includes("--dry-run");
  const say = (line) => console.log(dry ? `DRY RUN ${line}` : line);
  const linger = execFileSync("loginctl", ["show-user", userInfo().username, "-p", "Linger"], { encoding: "utf8" }).trim();
  if (linger !== "Linger=yes") throw new Error(`Linger is off, so a user timer stops at logout; the owner runs: sudo loginctl enable-linger ${userInfo().username}`);
  const repo = path.join(homedir(), "code", "storytree03");
  for (const name of ["runner", "measure"]) {
    const tree = path.join(BOX, name);
    if (existsSync(tree)) say(`${tree} is there`);
    else {
      say(`git worktree add --detach ${tree} origin/main`);
      if (!dry) {
        mkdirSync(BOX, { recursive: true });
        git(repo, "fetch", "-q", "origin", "main");
        git(repo, "worktree", "add", "--detach", tree, "origin/main");
        execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: tree, stdio: "inherit" });
      }
    }
  }
  const runner = path.join(BOX, "runner");
  const pnpm = execFileSync("which", ["pnpm"], { encoding: "utf8" }).trim();
  const service = [
    "[Unit]", "Description=Storytree: measure main's lag after merges (pnpm lag:box)", "",
    // The PATH this was installed from, less the folders pnpm adds for a script (a worktree's node_modules/.bin, corepack's).
    "[Service]", "Type=oneshot", `WorkingDirectory=${runner}`, `Environment=PATH=${(process.env.PATH ?? "").split(":").filter((dir) => !dir.includes("node_modules") && !dir.includes("corepack")).join(":")}`,
    // The runner's own code follows main, so a landing that changes the runner takes effect on the next tick.
    `ExecStartPre=/usr/bin/git -C ${runner} fetch -q origin main`, `ExecStartPre=/usr/bin/git -C ${runner} checkout -q --detach FETCH_HEAD`,
    `ExecStartPre=${pnpm} install --frozen-lockfile`, `ExecStart=${process.execPath} --import tsx packages/dev-loop/src/lag-box.mjs tick`,
    "TimeoutStartSec=3h", "Nice=5", `StandardOutput=append:${path.join(BOX, "tick.log")}`, `StandardError=append:${path.join(BOX, "tick.log")}`, "",
  ].join("\n");
  const timer = ["[Unit]", "Description=Storytree: look for a new main to measure every 15 minutes", "", "[Timer]", "OnCalendar=*:0/15", "", "[Install]", "WantedBy=timers.target", ""].join("\n");
  const units = path.join(homedir(), ".config", "systemd", "user");
  for (const [file, text] of [["storytree-lag-box.service", service], ["storytree-lag-box.timer", timer]]) {
    say(`write ${path.join(units, file)}`);
    if (dry) console.log(text);
    else {
      mkdirSync(units, { recursive: true });
      writeFileSync(path.join(units, file), text);
    }
  }
  say("systemctl --user daemon-reload && systemctl --user enable --now storytree-lag-box.timer");
  if (!dry) {
    execFileSync("systemctl", ["--user", "daemon-reload"]);
    execFileSync("systemctl", ["--user", "enable", "--now", "storytree-lag-box.timer"]);
    console.log(execFileSync("systemctl", ["--user", "list-timers", "storytree-lag-box.timer", "--no-pager"], { encoding: "utf8" }));
  }
}

async function main(args) {
  const [verb = "status", ...rest] = args;
  if (verb === "tick") return tick(rest);
  if (verb === "install") return install(rest);
  if (verb === "rebaseline") {
    const [action] = rest;
    const reason = option(rest, "reason", undefined);
    if (!ACTIONS.includes(action)) throw new Error(`usage: pnpm lag:box rebaseline <action> --reason <why> [--at <commit>]; actions: ${ACTIONS.join(", ")}`);
    if (!reason) throw new Error("a re-baseline records why the cost was accepted: --reason <why>");
    return withHistory(async (history) => {
      const head = option(rest, "at", undefined) ?? git(root, "rev-parse", "origin/main");
      await history.rebaseline({ action, head, reason });
      console.log(`${action}: baseline ${short(head)}, because ${reason}`);
    });
  }
  if (verb !== "status") throw new Error("usage: pnpm lag:box [status | rebaseline <action> --reason <why> [--at <commit>] | tick [--limit-minutes <n>] | install [--dry-run]]");
  return withHistory(async (history) => {
    const runs = await history.read();
    if (runs.length === 0) return console.log("lag:box: no runs yet");
    git(root, "fetch", "-q", "origin", "main");
    const mainLog = git(root, "log", "--first-parent", "-n", "2000", "--format=%H%x09%s", "origin/main").split("\n").filter(Boolean).reverse().map((line) => ({ commit: line.split("\t")[0], subject: line.split("\t").slice(1).join("\t") }));
    console.log(statusText({ history: runs, actions: ACTIONS, log: mainLog }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(`lag:box: ${error.message}`);
      process.exit(1);
    },
  );
}
