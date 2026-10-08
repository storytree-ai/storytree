// Capability 11 · A Mint track keeps its lanes fed (ADR-0931 D1): when its queue empties it takes
// the next ready increment in its fence from one library survey, under the manager's skip rules.
// node packages/dev-loop/src/lanes/feed.mjs next <track>     (the box's lanes folder: LANES_DIR, else ~/storytree-lanes)
import { appendFile, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { runQueue } from "./queue.mjs";

/** The website arc: its work is the laptop's (the manager's skip rule). */
export const WEBSITE_ARC = "arc_e42da2528db8";
const HOUR = 3_600_000;
const PATH = /\b(?:packages\/[a-z0-9-]+|apps\/desktop(?:\/src\/[a-z0-9-]+)?)/g;

/** night-fences.txt's tracks: each line `T=<paths and notes>`, read as the package paths it names. */
export function parseFences(text) {
  const fences = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z])=(.*)$/.exec(line.trim());
    if (match) fences[match[1]] = [...new Set(match[2].match(PATH) ?? [])];
  }
  return fences;
}

function outsideFence(body, track, fences) {
  const named = /\btrack ([A-Z])\b/.exec(body)?.[1];
  if (named) return named === track ? undefined : `named for track ${named}`;
  const paths = [...new Set(body.match(PATH) ?? [])];
  if (paths.length === 0) return "names no package, so its fence is unknown";
  const fence = fences[track] ?? [];
  const outside = paths.filter((path) => !fence.some((entry) => path === entry || path.startsWith(`${entry}/`)));
  return outside.length ? `outside track ${track}'s fence: ${outside.join(", ")}` : undefined;
}

/**
 * The oldest ready increment of `survey` inside `track`'s fence, and why each other candidate was skipped.
 * `attempts` maps each increment this runner has run to when it started it; a live claim older than that
 * start refused the lane, which is retried once that claim clears, and never otherwise (it records the refusal in `attempts`).
 */
export function pickNext(survey, { track, fences, attempts = new Map(), queued = new Map() }) {
  const skipped = [];
  const live = new Map(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => [claim.increment, claim]));
  const laptopArcs = new Set(survey.laptopArcs);
  const candidates = survey.increments.filter((one) => one.status !== "closed" && one.arcState === "active")
    .sort((a, b) => String(a.parked).localeCompare(String(b.parked)));
  for (const one of candidates) {
    const why = (() => {
      const attempt = attempts.get(one.id);
      const claim = live.get(one.id);
      if (claim) {
        if (attempt && Date.parse(claim.since) < attempt.at) attempt.refusedBy = claim.session;
        return `held by live session ${claim.session}`;
      }
      if (attempt && !attempt.refusedBy) return "already run by this runner";
      if (queued.has(one.id)) return `queued on track ${queued.get(one.id)}`;
      const waits = survey.holds.waits[one.id] ?? [];
      if (waits.length) return `waits on ${waits.map((hold) => hold.on).join(", ")}`;
      const questions = survey.holds.heldOn[one.id] ?? [];
      if (questions.length) return `held on ${questions.join(", ")}`;
      if (one.arc === WEBSITE_ARC) return "on the website arc";
      if (laptopArcs.has(one.arc)) return `its arc ${one.arc} was touched by a live laptop session in the last hour`;
      const needs = (one.body.match(/\bneeds:[^\n]*/gi) ?? []).join("\n");
      if (/\bowner\b/i.test(needs) || /\bowner action\b/i.test(one.body)) return "needs an owner action";
      if (/\blaptop\b/i.test(needs)) return "needs another machine";
      return outsideFence(one.body, track, fences);
    })();
    if (!why) return { pick: one.id, skipped };
    skipped.push({ id: one.id, why });
  }
  return { pick: undefined, skipped };
}

/**
 * One survey of the library: every arc's increments with their holds (one `arcViews` and one `holds` read),
 * the standing claims, and the arcs a live laptop session (one whose folders are not under this box's `home`)
 * claimed work on and was seen in the last hour.
 */
export async function readSurvey({ library, claims, sessions, now = Date.now(), home = homedir() }) {
  const [views, holds, held] = await Promise.all([library.arcViews(), library.holds(), claims()]);
  const increments = views.flatMap((view) => view.increments.map((record) => ({
    id: record.id, arc: view.arc.id, arcState: view.state, title: record.fields.title, body: record.fields.body ?? "",
    status: record.fields.status, parked: record.fields.parked ?? record.createdAt?.toISOString?.(), touches: record.fields.touches ?? [],
  })));
  const standing = held.filter((claim) => claim.holder === "live");
  const seen = await sessions([...new Set(standing.map((claim) => claim.session))]);
  const onBox = (folder) => folder.startsWith(home);
  const laptop = new Set(seen.filter((session) => now - Date.parse(session.lastSeenAt) <= HOUR
    && ![session.folder, ...session.worktrees].some((folder) => folder && onBox(folder))).map((session) => session.session));
  const laptopArcs = new Set();
  for (const claim of standing.filter((one) => laptop.has(one.session))) {
    for (const one of increments) {
      if (one.id === claim.increment || (claim.capability && one.status !== "closed" && one.touches.includes(claim.capability))) laptopArcs.add(one.arc);
    }
  }
  return { increments, holds, claims: held, laptopArcs: [...laptopArcs] };
}

/**
 * Each increment named in a track's queue file (night-queue-<T>.txt) in `lanesDir`, with its track: work another
 * track has queued or is running carries no claim until its lane claims it, so a refill must not take it too.
 */
export async function queuedOnTracks(lanesDir) {
  const queued = new Map();
  for (const name of (await readdir(lanesDir)).sort()) {
    const track = /^night-queue-([A-Z])\.txt$/.exec(name)?.[1];
    if (!track) continue;
    const text = await readFile(join(lanesDir, name), "utf8").catch(() => "");
    for (const line of text.split("\n").map((one) => one.trim()).filter(Boolean)) if (!queued.has(line)) queued.set(line, track);
  }
  return queued;
}

/**
 * Run the track's queue a lane at a time (queue.mjs's runQueue); when it empties, refill it from one survey,
 * skipping work any track has queued (`queued`), and when nothing is ready wait `intervalMs` and look again.
 * Ends only on the stop file, or 75 (an engine failing at once), which keeps that lane queued.
 */
export async function keepFed({ track, fences, queueFile, stopFile, survey, runLane, sleep = (ms) => wait(ms),
  queued = async () => new Map(), intervalMs = 15 * 60_000, now = Date.now, say = console.log }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const attempts = new Map();
  return runQueue({
    queueFile, stopFile, now, say,
    runLane: (id) => { attempts.set(id, { at: now() }); return runLane(id); },
    refill: async () => {
      let found;
      try { found = await survey(); }
      catch (error) {
        dated(`library survey failed (${String(error.message).split("\n")[0]}); looking again in ${Math.round(intervalMs / 60_000)} min`);
        await sleep(intervalMs);
        return true;
      }
      const { pick, skipped } = pickNext(found, { track, fences, attempts, queued: await queued() });
      if (pick) {
        dated(`took ${pick} from the library (${skipped.length} skipped)`);
        await appendFile(queueFile, `${pick}\n`);
      } else {
        dated(`nothing ready in track ${track}'s fence (${skipped.length} skipped); looking again in ${Math.round(intervalMs / 60_000)} min`);
        await sleep(intervalMs);
      }
      return true;
    },
  });
}

/** One survey of the shared library, where this computer's `library` setting says it is. */
export async function surveyLibrary(project = "storytree") {
  const { locateLibrary, openActivityLog, readClaims, readSessions } = await import("@storytree/agent-link");
  const { connect } = await import("@storytree/library");
  const where = locateLibrary();
  if (!where.found) throw new Error(where.message);
  const storytree = await connect(where.connect);
  try {
    const library = await storytree.openProject(project);
    try {
      const log = await openActivityLog(storytree);
      return await readSurvey({ library, claims: () => readClaims(log, project), sessions: (of) => readSessions(log, project, { of }) });
    } finally { await library.close(); }
  } finally { await storytree.close(); }
}

/**
 * `next <track>`: the increment the track's runner would take now, and why each other was skipped, from one
 * survey. The box's launch-night.sh runs keepFed through launch.mjs's `night <track>`.
 */
export async function main(args, { lanesDir = process.env.LANES_DIR || join(homedir(), "storytree-lanes"), survey = surveyLibrary, say = console.log } = {}) {
  if (args[0] !== "next" || !/^[A-Z]$/.test(args[1] ?? "")) { say("usage: feed.mjs next <track>"); return 2; }
  const fences = parseFences(await readFile(join(lanesDir, "night-fences.txt"), "utf8"));
  if (!fences[args[1]]) { say(`feed: night-fences.txt has no track ${args[1]}`); return 2; }
  const { pick, skipped } = pickNext(await survey(), { track: args[1], fences, queued: await queuedOnTracks(lanesDir) });
  for (const skip of skipped) say(`skip ${skip.id}: ${skip.why}`);
  say(pick ? `next: ${pick}` : `next: none ready in track ${args[1]}'s fence`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
