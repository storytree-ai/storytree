// Capability 11 · A Mint track keeps its lanes fed (ADR-0931 D1): when its queue empties it takes
// the next ready increment in its fence from one library survey, under the manager's skip rules.
// node packages/dev-loop/src/lanes/feed.mjs next <track>     (the box's lanes folder: LANES_DIR, else ~/storytree-lanes)
import { appendFile, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { queueLines, runQueue } from "./queue.mjs";

/** The website arc: its work is the laptop's (the manager's skip rule). */
export const WEBSITE_ARC = "arc_e42da2528db8";
const HOUR = 3_600_000;
const PATH = /\b(?:packages\/[a-z0-9-]+|apps\/desktop(?:\/src\/[a-z0-9-]+)?)/g;
/** A read-only track's whole fence: it writes no package. */
export const READ_ONLY = "read-only";

/**
 * night-fences.txt's tracks: each line `T=<paths and notes>`, read as the package paths it names; a line starting
 * `T=read-only` is a read-only track, whose fence is [READ_ONLY] whatever packages its notes mention.
 */
export function parseFences(text) {
  const fences = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z])=(.*)$/.exec(line.trim());
    if (match) fences[match[1]] = /^read-only\b/i.test(match[2].trim()) ? [READ_ONLY] : [...new Set(match[2].match(PATH) ?? [])];
  }
  return fences;
}

/** Work whose needs line says read-only: it writes no package, whatever packages it reads. */
function readOnly(body) {
  return (body.match(/\bneeds:[^\n]*/gi) ?? []).some((line) => /\bread-only\b/i.test(line));
}

/** Why `writes` may not run beside the `running` lanes, or undefined when it shares no package with them. */
function clash(writes, running) {
  for (const lane of running) {
    const path = sharedPath(writes, lane.writes);
    if (path) return `shares ${path} with running ${lane.id}`;
  }
  return undefined;
}

function outsideFence(body, track, fences) {
  const reviewTracks = Object.keys(fences).filter((each) => fences[each].includes(READ_ONLY));
  if (readOnly(body)) {
    if (reviewTracks.includes(track)) return undefined;
    return reviewTracks.length ? `read-only work, for track ${reviewTracks.join(" or ")}` : "read-only work, and no track's fence is read-only";
  }
  if (reviewTracks.includes(track)) return `track ${track} takes only read-only work`;
  const named = /\btrack ([A-Z])\b/.exec(body)?.[1];
  if (named) return named === track ? undefined : `named for track ${named}`;
  const paths = [...new Set(body.match(PATH) ?? [])];
  if (paths.length === 0) return "names no package, so its fence is unknown";
  const fence = fences[track] ?? [];
  const outside = paths.filter((path) => !fence.some((entry) => path === entry || path.startsWith(`${entry}/`)));
  return outside.length ? `outside track ${track}'s fence: ${outside.join(", ")}` : undefined;
}

/**
 * The package paths an increment writes: those in its body's "Write ownership" sentence, else those its body names,
 * else (naming none) the whole `fence`, so it runs alone; read-only work writes none. Never its capabilities list (ADR-0944 D2).
 */
export function writesOf(body, fence) {
  if (readOnly(body)) return [];
  const owned = /write ownership:(.*?)(?:\.\s|\.$|\n|$)/i.exec(body)?.[1]?.match(PATH) ?? body.match(PATH) ?? [];
  return owned.length ? [...new Set(owned)] : fence;
}

/** The first of `writes` that equals or contains, or lies inside, one of `other`'s, or undefined when disjoint. */
export function sharedPath(writes, other) {
  return writes.find((path) => other.some((each) => path === each || path.startsWith(`${each}/`) || each.startsWith(`${path}/`)));
}

/**
 * The oldest ready increment of `survey` inside `track`'s fence, and why each other candidate was skipped.
 * Beside `running` lanes ({ id, writes }) it skips work sharing a package with any of them.
 * `attempts` maps each increment this runner has run to when it started it; a live claim older than that
 * start refused the lane, which is retried once that claim clears, and never otherwise (it records the refusal in `attempts`).
 */
export function pickNext(survey, { track, fences, attempts = new Map(), queued = new Map(), running = [] }) {
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
      const notes = (survey.holds.waitsFor?.[one.id] ?? []).filter((hold) => hold.holds);
      if (notes.length) return notes.map((hold) => `waits for ${hold.releaser === "owner" ? "the owner" : "an event"}: ${hold.note}`).join("; ");
      const questions = survey.holds.heldOn[one.id] ?? [];
      if (questions.length) return `held on ${questions.join(", ")}`;
      if (one.arc === WEBSITE_ARC) return "on the website arc";
      if (laptopArcs.has(one.arc)) return `its arc ${one.arc} was touched by a live laptop session in the last hour`;
      const needs = (one.body.match(/\bneeds:[^\n]*/gi) ?? []).join("\n");
      if (/\bowner\b/i.test(needs) || /\bowner action\b/i.test(one.body)) return "needs an owner action";
      if (/\blaptop\b/i.test(needs)) return "needs another machine";
      return outsideFence(one.body, track, fences) ?? clash(writesOf(one.body, fences[track] ?? []), running);
    })();
    if (!why) return { pick: one.id, skipped };
    skipped.push({ id: one.id, why });
  }
  return { pick: undefined, skipped };
}

/**
 * One survey of the library: every arc's increments with their holds (one `arcViews` and one `holds` read),
 * the standing claims, and the arcs on which a live laptop session (one whose folders are not under this box's `home`),
 * seen in the last hour, holds an increment.
 */
export async function readSurvey({ library, claims, sessions, now = Date.now(), home = homedir() }) {
  const [views, holds, held] = await Promise.all([library.arcViews(), library.holds(), claims()]);
  const increments = views.flatMap((view) => view.increments.map((record) => ({
    id: record.id, arc: view.arc.id, arcState: view.state, title: record.fields.title, body: record.fields.body ?? "",
    status: record.fields.status, parked: record.fields.parked ?? record.createdAt?.toISOString?.(),
  })));
  const standing = held.filter((claim) => claim.holder === "live");
  const seen = await sessions([...new Set(standing.map((claim) => claim.session))]);
  const onBox = (folder) => folder.startsWith(home);
  const laptop = new Set(seen.filter((session) => now - Date.parse(session.lastSeenAt) <= HOUR
    && ![session.folder, ...session.worktrees].some((folder) => folder && onBox(folder))).map((session) => session.session));
  const laptopArcs = new Set();
  // An increment's capabilities list is a plan hint here, never a lock (ADR-0944 D2): only a claim on the increment marks its arc.
  for (const claim of standing.filter((one) => laptop.has(one.session) && one.increment)) {
    const one = increments.find((each) => each.id === claim.increment);
    if (one) laptopArcs.add(one.arc);
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
 * Run the track's queue (queue.mjs's runQueue), up to `limit` lanes at once; when it empties, refill it from one
 * survey, skipping work any track has queued (`queued`), and when nothing is ready wait `intervalMs` and look again.
 * Beside running lanes it starts, from one survey, the first queued increment sharing no package with them, else
 * one such increment from the library. As each lane starts, `markQueue` keeps the queue's event waits (markQueue
 * below); a failure to write them is said and the lane runs anyway. Ends only on the stop file, or 75 (an engine
 * failing at once), which keeps that lane queued.
 */
export async function keepFed({ track, fences, queueFile, stopFile, survey, runLane, sleep = (ms, options) => wait(ms, undefined, options),
  queued = async () => new Map(), markQueue: mark = async () => {}, limit = 1, intervalMs = 15 * 60_000, now = Date.now, say = console.log }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const attempts = new Map();
  const minutes = Math.round(intervalMs / 60_000);
  return runQueue({
    queueFile, stopFile, now, say, limit, sleep, intervalMs,
    runLane: async (id, running = []) => {
      attempts.set(id, { at: now() });
      try {
        const waiting = (await queueLines(queueFile)).filter((line) => line !== id && !running.includes(line));
        await mark({ track, starting: id, running, queued: waiting });
      } catch (error) { dated(`queue waits not written (${String(error.message).split("\n")[0]}); the lane runs anyway`); }
      return runLane(id);
    },
    beside: async (lines, ids) => {
      let found;
      try { found = await survey(); }
      catch (error) { dated(`library survey failed (${String(error.message).split("\n")[0]}); looking again in ${minutes} min`); return undefined; }
      const bodies = new Map(found.increments.map((one) => [one.id, one.body]));
      const fence = fences[track] ?? [];
      const running = ids.map((id) => ({ id, writes: writesOf(bodies.get(id) ?? "", fence) }));
      const within = ids.join(", ");
      const line = lines.find((id) => !clash(writesOf(bodies.get(id) ?? "", fence), running));
      if (line) { dated(`start ${line} beside ${within}: no shared package`); return line; }
      const { pick, skipped } = pickNext(found, { track, fences, attempts, queued: await queued(), running });
      if (pick) {
        dated(`took ${pick} from the library to run beside ${within} (${skipped.length} skipped)`);
        await appendFile(queueFile, `${pick}\n`);
        return pick;
      }
      dated(`nothing to run beside ${within} in track ${track}'s fence (${skipped.length} skipped); looking again in ${minutes} min`);
      return undefined;
    },
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

/** The note a track's runner writes on the event wait of work in its queue; an event wait with another note is never touched. */
const QUEUED = /^queued on Mint track [A-Z]\b/;

/**
 * Keep the board's reading of a track's queue true (increment_8fff1a33a371): the increment about to start loses the
 * runner's event wait first, since a holding wait refuses the lane's own claim; every other queued line gets or
 * refreshes one ("queued on Mint track T, behind X", checking back tomorrow), so the board reads it queued rather than
 * ready to take and other sessions' claims on it are refused while it waits. An event wait someone else wrote is left
 * alone; one left by a dropped queue stops holding on its check-back day.
 */
export async function markQueue({ library, track, starting, running = [], queued, now = Date.now(), actor = `runner:mint-track-${track}` }) {
  const waitsFor = (await library.holds()).waitsFor ?? {};
  const events = (id) => (waitsFor[id] ?? []).filter((wait) => wait.releaser === "event");
  if (events(starting).some((wait) => QUEUED.test(wait.note))) await library.removeWaitFor(starting, "event", { actor });
  const checkBack = new Date(now + 86_400_000).toISOString().slice(0, 10);
  let behind = [...running, starting].join(", ");
  for (const id of queued) {
    if (events(id).every((wait) => QUEUED.test(wait.note))) {
      await library.addWaitFor(id, { releaser: "event", note: `queued on Mint track ${track}, behind ${behind}`, checkBack }, { actor });
    }
    behind = id;
  }
}

/** markQueue against the shared library, where this computer's `library` setting says it is. */
export async function markQueueInLibrary(marks, project = "storytree") {
  return withLibrary(project, (library) => markQueue({ library, ...marks }));
}

async function withLibrary(project, use) {
  const { locateLibrary } = await import("@storytree/agent-link");
  const { connect } = await import("@storytree/library");
  const where = locateLibrary();
  if (!where.found) throw new Error(where.message);
  const storytree = await connect(where.connect);
  try {
    const library = await storytree.openProject(project);
    try { return await use(library, storytree); }
    finally { await library.close(); }
  } finally { await storytree.close(); }
}

/** One survey of the shared library, where this computer's `library` setting says it is. */
export async function surveyLibrary(project = "storytree") {
  const { openActivityLog, readClaims, readSessions } = await import("@storytree/agent-link");
  return withLibrary(project, async (library, storytree) => {
    const log = await openActivityLog(storytree);
    return readSurvey({ library, claims: () => readClaims(log, project), sessions: (of) => readSessions(log, project, { of }) });
  });
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
