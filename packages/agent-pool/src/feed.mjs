// Capability 2 · The Mint pool keeps its lanes fed (ADR-0955 D2): one survey of the library names every active
// arc's ready increments, under the manager's skip rules, and claims are the only conflict guard.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The body's leading needs clause: its first needs label, up to that sentence's full stop or the line's end. Later wording, and a needs label quoted later, are not its need. */
function needs(body) {
  return body.match(/\bneeds:(?:[^\n.]|\.(?!\s|$))*/i)?.[0] ?? "";
}

/** Work whose needs clause says read-only: it writes no package, whatever packages it reads. */
export function readOnly(body) {
  return /\bread-only\b/i.test(needs(body));
}

/** Work whose needs clause says blind: a blind reviewer's (ADR-0950). */
export function blind(body) {
  return /\bblind\b/i.test(needs(body));
}

/** A wait's note that says its pull request is with the watcher: the hand-off's event wait, or the watcher's own record. */
const HANDED = /\bthe Mint box's watcher\b/;

/**
 * Each capability a live session holds, by the claim that holds it: one on the list of an increment a live session holds,
 * as the edit gate reads it (ADR-0949 D3), with `on` naming that increment, and a direct claim over it.
 */
function liveCapabilities(claims, increments) {
  const listOf = new Map(increments.map((one) => [one.id, one.capabilities ?? []]));
  const held = new Map(claims.filter((claim) => claim.holder === "live" && claim.increment)
    .flatMap((claim) => (listOf.get(claim.increment) ?? []).map((capability) => [capability, { ...claim, capability, on: claim.increment }])));
  for (const claim of claims) if (claim.holder === "live" && claim.capability) held.set(claim.capability, claim);
  return held;
}

/** The failed lanes after which the pool offers an increment no more (2.27): its residue names them, and a session that fixed the cause offers it again (2.28). */
export const LANE_FAILURES = 3;

/** An increment's place by its arc's priority (ADR-0963 D1): 1 first, an arc with none after every ranked one. */
const rank = (one) => one.priority ?? Infinity;

/**
 * The pool's next `max` increments from one survey (ADR-0955 D2), and why each other was skipped. A candidate is
 * not closed, sits on an active arc, has no live claim on it or on a capability its list names (directly, or on the list of an
 * increment a live session holds), no capability its lane was refused while any live session holds it (whoever it passed to), no wait or held-on
 * question (only those say it needs the owner; its body's wording never does), its machine field, when set, names this
 * machine (`survey.here`; its body's wording never names one); no fence or track is read. By arc priority, then oldest parked first, and within one priority
 * those on an arc no live session (nor a pick already made) is on before the rest (ADR-0963 D2). `running` names the increments this dispatcher is running, never started
 * twice; `attempts` maps each increment this dispatcher has started to when it started it: a live claim older than that start
 * (on it, on a listed capability or on one its lane was refused) refused it, and it is retried only once that claim clears (it records the refusal in `attempts`). Work whose session has
 * ended and is back in the pool (it bounced on a capability claim, say) is offered again `backoffMs` after the first
 * survey that found the session gone (it records that in `attempts` as `ended`), so a bounce needs no restart and a
 * session that bounces every time starts at most once a back-off. Within one survey (ADR-1079 D1), a candidate whose known needs (its
 * capabilities list plus every capability refused under it, whoever holds that now) meet those of an earlier pick or of an increment
 * in `running` is not picked: it is skipped naming the shared capability and the increment that took it, and offered again on the next survey.
 * Work whose lanes failed LANE_FAILURES times (`survey.failures`, its lane-failed lines, which outlast the dispatcher) is not offered at all (2.27).
 */
export function pickPool(survey, { attempts = new Map(), running = [], max = 1, now = Date.now(), backoffMs = 30 * 60_000 }) {
  const skipped = [];
  const live = new Map(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => [claim.increment, claim]));
  const held = liveCapabilities(survey.claims, survey.increments);
  // A lane refused a capability before it was on the list is held off by that refusal while any live session holds the capability.
  const refusedUnder = Map.groupBy((survey.refusals ?? []).filter((refusal) => held.has(refusal.capability)), (refusal) => refusal.under);
  const failuresOf = Map.groupBy(survey.failures ?? [], (failure) => failure.increment);
  const arcOf = new Map(survey.increments.map((one) => [one.id, one.arc]));
  const busy = new Set([...live.keys(), ...running].map((id) => arcOf.get(id)).filter(Boolean));
  const ready = [];
  const candidates = survey.increments.filter((one) => one.status !== "closed" && one.arcState === "active")
    .sort((a, b) => rank(a) - rank(b) || String(a.parked).localeCompare(String(b.parked)));
  for (const one of candidates) {
    const why = (() => {
      if (running.includes(one.id)) return "running now";
      const failures = failuresOf.get(one.id) ?? [];
      if (failures.length >= LANE_FAILURES) return `its lanes failed ${failures.length} times (${failures.map((failure) => failure.at).join(", ")}): the pool offers it no more until a session that fixed the cause offers it again (feed.mjs reoffer ${one.id} --reason …)`;
      const attempt = attempts.get(one.id);
      const claim = live.get(one.id);
      if (claim) {
        if (attempt && !attempt.refusedBy && Date.parse(claim.since) < attempt.at) attempt.refusedBy = claim.session;
        return `held by live session ${claim.session}`;
      }
      const listed = (one.capabilities ?? []).map((capability) => held.get(capability)).filter(Boolean);
      if (listed.length) {
        if (attempt && !attempt.refusedBy && listed.some((hold) => Date.parse(hold.since) < attempt.at)) attempt.refusedBy = listed[0].session;
        return listed.map((hold) => `${hold.capability} held by live session ${hold.session}${hold.on ? ` on the list of ${hold.on}` : ""}`).join("; ");
      }
      const refused = (refusedUnder.get(one.id) ?? []).map((refusal) => held.get(refusal.capability));
      if (refused.length) {
        if (attempt && !attempt.refusedBy && refused.some((hold) => Date.parse(hold.since) < attempt.at)) attempt.refusedBy = refused[0].session;
        return [...new Set(refused.map((hold) => `${hold.capability} refused its lane, held by live session ${hold.session}`))].join("; ");
      }
      if (attempt && !attempt.refusedBy) {
        attempt.ended ??= now;
        if (now < attempt.ended + backoffMs) return `already run by this dispatcher; offered again after ${new Date(attempt.ended + backoffMs).toISOString()}`;
      }
      const waits = survey.holds.waits[one.id] ?? [];
      if (waits.length) return `waits on ${waits.map((hold) => hold.on).join(", ")}`;
      const notes = (survey.holds.waitsFor?.[one.id] ?? []).filter((hold) => hold.holds);
      if (notes.length) return notes.map((hold) => `waits for ${hold.releaser === "owner" ? "the owner" : "an event"}: ${hold.note}`).join("; ");
      const questions = survey.holds.heldOn[one.id] ?? [];
      if (questions.length) return `held on ${questions.join(", ")}`;
      if (one.machine && one.machine !== survey.here) return `needs ${one.machine}`;
      return undefined;
    })();
    if (why) skipped.push({ id: one.id, why });
    else ready.push(one);
  }
  const refusedOf = Map.groupBy(survey.refusals ?? [], (refusal) => refusal.under);
  const needsOf = (one) => new Set([...(one.capabilities ?? []), ...(refusedOf.get(one.id) ?? []).map((refusal) => refusal.capability)]);
  // A lane still starting has claimed nothing yet, so the round's taken capabilities start from the running increments' known needs.
  const taken = new Map();
  for (const one of survey.increments.filter((one) => running.includes(one.id))) {
    for (const capability of needsOf(one)) if (!taken.has(capability)) taken.set(capability, `${one.id}, running now`);
  }
  const picks = [];
  while (picks.length < max && ready.length) {
    const idle = ready.findIndex((one) => !busy.has(one.arc));
    const at = idle > 0 && rank(ready[idle]) !== rank(ready[0]) ? 0 : Math.max(0, idle);
    const [one] = ready.splice(at, 1);
    const known = needsOf(one);
    const shared = [...known].find((capability) => taken.has(capability));
    if (shared) {
      skipped.push({ id: one.id, why: `shares ${shared} with ${taken.get(shared)}` });
      continue;
    }
    for (const capability of known) taken.set(capability, `${one.id}, started this round`);
    busy.add(one.arc);
    picks.push(one);
  }
  return { picks, skipped };
}

/**
 * An arc's state as planning reads it: its open questions and each open increment with its status and what holds it.
 * Equal states mean nothing a planning session acts on has changed, however many surveys apart they were read.
 */
export function planState(survey, arcId) {
  const arc = (survey.arcs ?? []).find((one) => one.id === arcId);
  const holds = (id) => ({
    waits: (survey.holds.waits[id] ?? []).map((hold) => hold.on).sort(),
    heldOn: [...(survey.holds.heldOn[id] ?? [])].sort(),
    waitsFor: (survey.holds.waitsFor?.[id] ?? []).filter((hold) => hold.holds).map((hold) => `${hold.releaser}: ${hold.note}`).sort(),
  });
  const open = survey.increments.filter((one) => one.arc === arcId && one.status !== "closed")
    .sort((a, b) => a.id.localeCompare(b.id)).map((one) => [one.id, one.status, holds(one.id)]);
  return JSON.stringify([arc?.openQuestions ?? 0, open]);
}

/**
 * The arc a planning session should take when nothing is ready (ADR-0955 D4): an active arc with no open question and no open increment that is unwaited (every one waits on work, an event or a question),
 * none of them waiting on the owner, a question or work that can still land (planning has nothing to add there: the waits name what releases them, 2.21), oldest first, skipping an arc whose own wait holds on work that can still land (2.22) and an arc whose entry in `planned` (arc to the planState it was last planned in, kept across the dispatcher's restarts)
 * is its present state: an arc waiting on the owner is planned once until something on it changes. An arc made less than `freshMs` before `now` is skipped too:
 * the session that made it may still be parking its work (arc_c331455caee0 was planned 20 seconds after it was made, and both parked the same pieces), and so is one whose making time cannot be read. The arc comes with its `state`, for `planned`.
 * Undefined when none qualifies. Work handed to the watcher, or waiting on work that is (at any depth), is in flight like claimed work, not stalled.
 */
export function pickPlan(survey, { planned = new Map(), now = Date.now(), freshMs = 30 * 60_000 } = {}) {
  const live = new Set(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => claim.increment));
  const handed = (id, seen = new Set()) => !seen.has(id) && (seen.add(id), (survey.holds.waitsFor?.[id] ?? []).some((hold) => hold.holds && HANDED.test(hold.note))
    || (survey.holds.waits[id] ?? []).some((hold) => handed(hold.on, seen)));
  const waited = (id) => !live.has(id) && !handed(id) && ((survey.holds.waits[id] ?? []).length > 0 || (survey.holds.heldOn[id] ?? []).length > 0
    || (survey.holds.waitsFor?.[id] ?? []).some((hold) => hold.holds));
  const settled = (id) => (survey.holds.waits[id] ?? []).some((hold) => !hold.forGood) || (survey.holds.heldOn[id] ?? []).length > 0
    || (survey.holds.waitsFor?.[id] ?? []).some((hold) => hold.holds && hold.releaser === "owner");
  const open = Map.groupBy(survey.increments.filter((one) => one.status !== "closed"), (one) => one.arc);
  const fresh = (arc) => !(now - Date.parse(arc.created) >= freshMs);
  const arc = (survey.arcs ?? []).filter((one) => one.state === "active" && !one.openQuestions && !settled(one.id) && !fresh(one)
    && (open.get(one.id) ?? []).every((increment) => waited(increment.id) && !settled(increment.id)) && planned.get(one.id) !== planState(survey, one.id))
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))[0];
  return arc && { ...arc, state: planState(survey, arc.id) };
}

/**
 * One survey of the library: every arc with its open questions counted, its increments with their holds and machine fields (one `arcViews` and one `holds` read),
 * this machine's short name (`here`, undefined while it has none), the standing claims,
 * the refusals under every open increment on an active arc, whoever holds the capability now, each under the increment its refused session held (`refusals`, given those increments),
 * and the failed lanes on those increments (`failures`, given them).
 */
/** A record's time as an ISO string: the library gives it as one, a Date is turned into one, and a missing or unreadable time is undefined. */
const iso = (at) => {
  const time = at == null ? NaN : new Date(at).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
};

export async function readSurvey({ library, claims, refusals = async () => [], failures = async () => [], here = async () => undefined }) {
  const [views, holds, held, name] = await Promise.all([library.arcViews(), library.holds(), claims(), here()]);
  const increments = views.flatMap((view) => view.increments.map((record) => ({
    id: record.id, arc: view.arc.id, arcState: view.state, title: record.fields.title, body: record.fields.body ?? "",
    status: record.fields.status, capabilities: record.fields.capabilities ?? [], machine: record.fields.machine, parked: record.fields.parked ?? iso(record.createdAt), priority: view.arc.fields?.priority,
  })));
  const arcs = views.map((view) => ({
    id: view.arc.id, state: view.state, title: view.arc.fields?.title ?? view.arc.id, created: iso(view.arc.createdAt),
    openQuestions: (view.questions ?? []).filter((question) => question.fields.lifecycle === "open").length,
  }));
  const open = increments.filter((one) => one.status !== "closed" && one.arcState === "active").map((one) => one.id);
  const [refused, failed] = open.length ? await Promise.all([refusals(open), failures(open)]) : [[], []];
  return { arcs, increments, holds, claims: held, here: name, refusals: refused, failures: failed };
}

export async function withLibrary(project, use) {
  const { locateLibrary } = await import("@storytree/project-and-caller");
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
  const { openActivityLog, readClaims } = await import("@storytree/session-management");
  const { thisComputer } = await import("@storytree/session-management/machines");
  return withLibrary(project, async (library, storytree) => {
    const log = await openActivityLog(storytree);
    const refusals = async (under) => (await log.lines(project, { kinds: ["claim-refused"], where: { under }, omit: ["reason", "file"] }))
      .map((line) => ({ capability: line.capability, under: line.under, holder: line.holder }));
    return readSurvey({ library, claims: () => readClaims(log, project), refusals, failures: laneFailures(log, project), here: async () => (await thisComputer(storytree)).name });
  });
}

/** The session a lane-failed line is written on: the pool's own, which reads as no session. */
export const POOL_SESSION = "pool";

/** The lines an increment's failure count is read from (2.28). */
const COUNT_KINDS = ["lane-failed", "lane-reoffered"];

/** The lane-failed lines that still count, oldest first: on each increment, only those after its newest lane-reoffered line (2.28). */
function counted(lines) {
  const since = new Map(lines.filter((line) => line.kind === "lane-reoffered").map((line) => [line.increment, line.seq]));
  return lines.filter((line) => line.kind === "lane-failed" && line.seq > (since.get(line.increment) ?? -Infinity));
}

/** The survey's reading of the failures that count under the given increments (2.27, 2.28), from the activity log. */
export function laneFailures(log, project) {
  return async (increment) => counted(await log.lines(project, { kinds: COUNT_KINDS, where: { increment }, omit: ["logs"] }))
    .map((line) => ({ increment: line.increment, at: line.at, why: line.why }));
}

/**
 * Record a failed lane (2.27): a lane-failed line on the pool for `failure.increment`, and the increment's failures so far, oldest first.
 * A lane whose session (`failure.lane`) was refused a claim since it `started` is no failure: nothing is written, and null comes back.
 */
export async function noteLaneFailure({ log, project, failure }) {
  const { increment, why, logs, lane, started } = failure;
  if (lane && (await log.lines(project, { kinds: ["claim-refused"], sessions: [lane], ...(started ? { since: started } : {}), newest: 1 })).length) return null;
  await log.append(project, { session: POOL_SESSION, harness: "pool", source: "tool", kind: "lane-failed", increment, why, logs, ...(lane ? { lane } : {}) });
  return counted(await log.lines(project, { kinds: COUNT_KINDS, where: { increment } })).map((line) => ({ increment: line.increment, at: line.at, why: line.why, logs: line.logs }));
}

/**
 * Offer `increment` to the pool again (2.28): a lane-reoffered line on the pool, saying `why` and naming the session `by`, after which its
 * failures count from none. Refused, writing nothing, when no failure counts yet. Gives back how many failures it cleared.
 */
export async function reoffer({ log, project, increment, why, by }) {
  if (!why?.trim()) throw new Error("say what was fixed: --reason …");
  const cleared = counted(await log.lines(project, { kinds: COUNT_KINDS, where: { increment }, omit: ["logs"] })).length;
  if (!cleared) throw new Error(`${increment} has no failed lane counted against it, so there is nothing to clear`);
  await log.append(project, { session: POOL_SESSION, harness: "pool", source: "tool", kind: "lane-reoffered", increment, why, ...(by ? { by } : {}) });
  return cleared;
}

/** node packages/agent-pool/src/feed.mjs reoffer <increment> --reason "…": offer an increment the pool gave up on to it again, in the shared library. */
export async function main(args, { env = process.env, say = console.log, complain = console.error, offer } = {}) {
  const at = args.indexOf("--reason");
  const [verb, increment] = args;
  const why = at >= 0 ? args[at + 1] : undefined;
  if (verb !== "reoffer" || !increment || increment.startsWith("--") || !why) {
    complain('usage: feed.mjs reoffer <increment> --reason "what was fixed"');
    return 2;
  }
  const by = env.CLAUDE_CODE_SESSION_ID || env.CODEX_THREAD_ID || undefined;
  const write = offer ?? (async (request) => {
    const { openActivityLog } = await import("@storytree/session-management");
    return withLibrary("storytree", async (_library, storytree) => reoffer({ log: await openActivityLog(storytree), project: "storytree", ...request }));
  });
  try {
    const cleared = await write({ increment, why, by });
    say(`${increment} is offered to the pool again; cleared ${cleared} failed lane${cleared === 1 ? "" : "s"}, and it now has ${LANE_FAILURES} more before the pool gives up on it again.`);
    return 0;
  } catch (error) {
    complain(`reoffer refused: ${String(error.message).split("\n")[0]}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

/** Record a failed lane in the shared library, where this computer's `library` setting says it is (noteLaneFailure). */
export async function recordLaneFailure(failure, project = "storytree") {
  const { openActivityLog } = await import("@storytree/session-management");
  return withLibrary(project, async (_library, storytree) => noteLaneFailure({ log: await openActivityLog(storytree), project, failure }));
}
