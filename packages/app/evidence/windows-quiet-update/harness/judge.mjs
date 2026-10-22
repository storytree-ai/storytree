// Contract 4.4's Windows run (increment_341abe802574): mint each check from what the harness logged,
// and write observations.json for `pnpm record:acceptance`. Nothing here reads a model's account:
// only the files the harness scripts wrote in each run's folder:
//   t0.txt (launch), steps.tsv (watch.ps1, every 15 s), phases.tsv (phases.ps1 / seed-run.ps1),
//   gear.tsv (gear-run.ps1, every 5 s), snapshots.tsv (list-snapshots.ps1), reopened.txt (capture-reopen.ps1), pgdata-log.txt (the home's Postgres log)
//   node judge.mjs <quiet-run dir> <gear-run dir> <gear-at-once dir> <seed-run dir> <commit> <evidence path>
// A hold is observed only over a stretch of at least CHECK_MS, the updater's check interval, in which
// it was the one thing holding the update; a shorter stretch is not-observed, never a pass. Each rule
// is judged in the run built to isolate it: launch, agents and the window in run 1, the gear and a
// snapshot in run 2, the gear with nothing holding it in run 2b, a seed in run 3 (run 1's seeds ended within one check of the other holds).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [quietDir, gearDir, atOnceDir, seedDir, commit, evidence] = process.argv.slice(2);
if (evidence === undefined) throw new Error("usage: judge.mjs <quiet-run dir> <gear-run dir> <gear-at-once dir> <seed-run dir> <commit> <evidence path>");
const MIN = 60_000, SETTLE = 10 * MIN, QUIET = 10 * MIN, CHECK_MS = 3 * MIN;
const OLD = /^0\.3\.1690\./, at = (s) => Date.parse(s), iso = (t) => new Date(t).toISOString();
const stretch = (from, to) => `${iso(from)} to ${iso(to)} (${((to - from) / MIN).toFixed(1)} min)`;

function table(file) {
  const [head, ...rows] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const names = head.split("\t");
  return rows.map((row) => ({ ...Object.fromEntries(row.split("\t").map((cell, i) => [names[i], cell])), t: at(row.split("\t")[0]) }));
}
function run(dir) {
  const t0 = at(readFileSync(path.join(dir, "t0.txt"), "utf8").trim());
  // From launch on: a watcher started before a run's reinstall first sees the version it replaces.
  const steps = table(path.join(dir, "steps.tsv")).filter((r) => r.t >= t0);
  const firstNew = steps.find((r) => r.version !== "" && !OLD.test(r.version));
  return {
    t0,
    steps,
    phases: existsSync(path.join(dir, "phases.tsv")) ? table(path.join(dir, "phases.tsv")) : [],
    firstNew,
    installedAt: firstNew?.t ?? Infinity,
    heldOver: (from, to) => steps.filter((r) => r.t >= from && r.t < to),
  };
}
const allOld = (rows) => rows.length > 0 && rows.every((r) => OLD.test(r.version));

const checks = [];
const check = (name, ok, detail, observed = ok ? "pass" : "fail") => checks.push({ contract: "4.4", name, observed, detail });

/** The database's last "shut down" before `by` in the home's Postgres log (its times are AEDT, UTC+11). */
function databaseStopped(dir, by) {
  const file = path.join(dir, "pgdata-log.txt");
  if (!existsSync(file)) return undefined;
  const stops = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.includes("database system is shut down"))
    .map((l) => at(`${l.slice(0, 23).replace(" ", "T")}+11:00`)).filter((t) => t <= by);
  return stops.length > 0 ? Math.max(...stops) : undefined;
}
/** The app the installer reopened: its start time, from reopened.txt, when its command line says --updated. */
function reopened(dir) {
  const file = path.join(dir, "reopened.txt");
  if (!existsSync(file)) return undefined;
  const first = readFileSync(file, "utf8").split(/\r?\n/)[0];
  const started = /started (\S+)/.exec(first)?.[1];
  return first.includes("--updated") && started !== undefined ? { started: at(started), line: first } : undefined;
}
/** Installing: the database stops after `from`, the new version lands, and the installer reopens the new app. */
function installs(name, dir, r, from) {
  const stopped = databaseStopped(dir, r.installedAt);
  const reopen = reopened(dir);
  check(name,
    r.firstNew !== undefined && r.installedAt >= from && stopped !== undefined && stopped >= from && reopen !== undefined && reopen.started >= stopped,
    r.firstNew === undefined ? "never installed" :
      `allowed from ${iso(from)}; database shut down ${stopped === undefined ? "never" : iso(stopped)}; ${r.firstNew.version} installed by ${r.firstNew.utc}; ` +
      `the installer reopened the new app: ${reopen?.line ?? "not seen"} (through Explorer, so in the default home, where this laptop's follow-main app made it refuse, 4.18; reopened.txt)`);
}

// ---- run 1: launch, agents, the window; then it installs at a quiet moment ----
const q = run(quietDir);
const downloaded = q.steps.find((r) => /downloaded; waiting for a quiet moment/.test(r.releases_log_last));
{
  const rows = q.heldOver(q.t0, q.t0 + SETTLE);
  check("a newer release, downloaded and verified within the first ten minutes after launch, is not installed in them",
    downloaded !== undefined && downloaded.t < q.t0 + SETTLE && allOld(rows) && q.installedAt >= q.t0 + SETTLE,
    `launch ${iso(q.t0)}; releases.log said downloaded and waiting by ${downloaded?.utc ?? "never"}; ${rows.length} samples in the first ten minutes, all 0.3.1690`);
}
const agentTimes = q.steps.map((r) => r.agent_active_at).filter(Boolean).map(at);
const lastAgent = agentTimes.length > 0 ? Math.max(...agentTimes) : undefined;
const agentTo = lastAgent === undefined ? q.t0 + SETTLE : lastAgent + QUIET;
{
  const from = q.t0 + SETTLE, rows = q.heldOver(from, agentTo), long = agentTo - from >= CHECK_MS;
  check("after the settle, while an agent session that has not ended wrote to the app's library in the last ten minutes, the update is not installed",
    long && allOld(rows) && q.installedAt >= agentTo,
    `last agent line ${lastAgent === undefined ? "none" : iso(lastAgent)}; agents alone held it ${stretch(from, agentTo)}; ${rows.length} samples, all 0.3.1690`,
    long ? undefined : "not-observed");
}
// Seed stretches: each contiguous run of samples with a seed connection open.
const seedStretches = (steps) => {
  const blocks = [];
  steps.forEach((r, i) => {
    if (r.seed_writing !== "True") return;
    const last = blocks.at(-1);
    if (last !== undefined && last.end === i - 1) { last.end = i; last.to = r.t; } else blocks.push({ from: r.t, to: r.t, end: i });
  });
  return blocks;
};
const qSeeds = seedStretches(q.steps);
const opened = q.phases.find((r) => r.phase.startsWith("window: opened"));
const inputs = q.phases.filter((r) => r.phase.startsWith("window: mouse moved")).map((r) => r.t);
const lastInput = inputs.length > 0 ? Math.max(...inputs) : undefined;
const windowTo = lastInput === undefined ? 0 : lastInput + QUIET;
{
  // Alone: after the settle, the agents' hold, the window's showing and any seed that ended inside it; until the window's hold ends or a later seed starts.
  const from = Math.max(q.t0 + SETTLE, agentTo, opened?.t ?? Infinity, ...qSeeds.filter((b) => b.from < agentTo).map((b) => b.to));
  const laterSeed = qSeeds.find((b) => b.from > from && b.from < windowTo);
  const to = Math.min(windowTo, laterSeed?.from ?? Infinity);
  const rows = q.heldOver(from, to), long = to - from >= CHECK_MS;
  check("with the window shown, input in the last ten minutes holds the update when nothing else does",
    long && allOld(rows) && q.installedAt >= windowTo,
    `window shown ${opened?.utc ?? "never"}; ${inputs.length} inputs, last ${lastInput === undefined ? "none" : iso(lastInput)}; the window alone held it ${stretch(from, to)}; ${rows.length} samples, all 0.3.1690`,
    long ? undefined : "not-observed");
}
const qQuietFrom = Math.max(q.t0 + SETTLE, agentTo, windowTo, ...qSeeds.map((b) => b.to));
installs("at the first quiet moment after them it stops its database and installs the newer release through its installer, which reopens the new app",
  quietDir, q, qQuietFrom);

/** A gear run: its launch, the gear log (every 5 s), the click, and the first sample of the new version. */
function gearRun(dir) {
  const g = run(dir);
  const gear = table(path.join(dir, "gear.tsv"));
  // The click's moment is the gear's own reading just before it (gear.mjs click reads, presses, waits 1 s, reads again; the row is logged after).
  const clickRow = gear.find((r) => r.what === "click");
  const click = clickRow === undefined ? undefined : { ...clickRow, t: at(/"before":\{"at":"([^"]+)"/.exec(clickRow.read)[1]) };
  // After launch only: the gear log's first rows are from before the reinstall.
  const gNew = [...g.steps, ...gear].filter((r) => r.t > g.t0 && r.version !== "" && !OLD.test(r.version)).sort((a, b) => a.t - b.t)[0];
  return { g, gear, click, gNew, stopped: databaseStopped(dir, gNew?.t ?? Infinity) };
}

// ---- run 2: a snapshot being written holds even the gear's restart ----
if (existsSync(path.join(gearDir, "gear.tsv"))) {
  const { g, gear, click, gNew, stopped } = gearRun(gearDir);
  // The app's own record of the pass it ran after launch (snapshots.tsv, list-snapshots.ps1): from the
  // moment its files are named for to the last one's write. The run's 3-byte stand-ins are not snapshots.
  const pass = table(path.join(gearDir, "snapshots.tsv")).filter((r) => Number(r.bytes) > 3 && at(r.pass_began_utc) >= g.t0);
  const passFrom = pass.length > 0 ? Math.min(...pass.map((r) => at(r.pass_began_utc))) : undefined;
  const passTo = pass.length > 0 ? Math.max(...pass.map((r) => at(r.written_utc))) : undefined;
  const during = click !== undefined && passFrom !== undefined && click.t >= passFrom && click.t <= passTo;
  const held = gear.filter((r) => click !== undefined && r.t > click.t && r.t <= passTo && r.what === "status");
  const pending = held.filter((r) => OLD.test(r.version) && r.read.includes('"phase":"pending"'));
  check("a snapshot being written holds even the gear's Restart to update, with the window open and the update pending, until it finishes",
    during && held.length > 0 && pending.length === held.length && gNew !== undefined && gNew.t > passTo && stopped !== undefined && stopped > passTo,
    `the app's daily snapshot pass of ${pass.length} projects ran ${passFrom === undefined ? "never" : stretch(passFrom, passTo)}; clicked ${click === undefined ? "never" : iso(click.t)}; ` +
      `${pending.length} of ${held.length} gear readings during the rest of the pass read pending on 0.3.1690; database shut down ${stopped === undefined ? "never" : iso(stopped)}; ${gNew?.version ?? "nothing"} installed by ${gNew?.utc ?? "never"} (launch ${iso(g.t0)})`,
    during ? undefined : "not-observed");
}

// ---- run 2b: with nothing holding it, the gear's restart installs at once ----
if (existsSync(path.join(atOnceDir, "gear.tsv"))) {
  const { g, click, gNew, stopped } = gearRun(atOnceDir);
  check("the gear's Restart to update installs at once, inside the ten-minute settle, without waiting for a quiet moment",
    click !== undefined && gNew !== undefined && gNew.t < g.t0 + SETTLE && stopped !== undefined && stopped >= click.t && stopped - click.t < 30_000,
    `launch ${iso(g.t0)}; clicked ${click === undefined ? "never" : iso(click.t)}; database shut down ${stopped === undefined ? "never" : `${iso(stopped)} (${((stopped - click.t) / 1000).toFixed(1)} s after the click)`}; ${gNew?.version ?? "nothing"} installed by ${gNew?.utc ?? "never"}`);
  installs("the gear's install goes through the installer, which reopens the new app", atOnceDir, { ...g, firstNew: gNew, installedAt: gNew?.t ?? Infinity }, click?.t ?? Infinity);
}

// ---- run 3: a seed alone holds it; then it installs ----
if (existsSync(path.join(seedDir, "steps.tsv"))) {
  const s = run(seedDir);
  const seed = seedStretches(s.steps).at(-1);
  const from = seed === undefined ? 0 : Math.max(seed.from, s.t0 + SETTLE);
  const long = seed !== undefined && seed.to - from >= CHECK_MS;
  const rows = seed === undefined ? [] : s.heldOver(from, seed.to + 1);
  check("once launch, agents and the window are all quiet, a library seed being written still holds the update until it finishes",
    long && allOld(rows) && rows.every((r) => r.seed_writing === "True") && s.installedAt > seed.to,
    seed === undefined ? "no seed observed" :
      `launch ${iso(s.t0)} in the background, no agent lines; the seed ran ${stretch(seed.from, seed.to)} and alone held it ${stretch(from, seed.to)}; ${rows.length} samples, all 0.3.1690 with a seed connection open`,
    long ? undefined : "not-observed");
  installs("once the seed finishes it stops its database and installs the newer release through its installer, which reopens the new app",
    seedDir, s, seed === undefined ? Infinity : seed.to);
}

const out = { story: "story_a93c6fb1a257", release: "0.3.1690 to the newest development release (0.3.1691; 0.3.1692 once it was published, in runs 2b and 3)", commit, evidence, checks };
writeFileSync(path.join(quietDir, "observations.json"), `${JSON.stringify(out, null, 2)}\n`);
for (const c of checks) console.log(`${c.observed.toUpperCase()}\t${c.name}\n\t${c.detail}`);
