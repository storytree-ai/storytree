// Capability 2 · The pool keeps its lanes fed (ADR-0955 D2).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function needs(body) {
  return body.match(/\bneeds:(?:[^\n.]|\.(?!\s|$))*/i)?.[0] ?? "";
}

export function readOnly(body) {
  return /\bread-only\b/i.test(needs(body));
}

export function blind(body) {
  return /\bblind\b/i.test(needs(body));
}

export const HANDED = /\b(?:handed to|is with) the [\w ]+'s watcher\b/;

function liveCapabilities(claims, increments) {
  const listOf = new Map(increments.map((one) => [one.id, one.capabilities ?? []]));
  const held = new Map(claims.filter((claim) => claim.holder === "live" && claim.increment)
    .flatMap((claim) => (listOf.get(claim.increment) ?? []).map((capability) => [capability, { ...claim, capability, on: claim.increment }])));
  for (const claim of claims) if (claim.holder === "live" && claim.capability) held.set(claim.capability, claim);
  return held;
}

export const LANE_FAILURES = 3;

const rank = (one) => one.priority ?? Infinity;

export function pickPool(survey, { attempts = new Map(), running = [], max = 1, now = Date.now(), backoffMs = 30 * 60_000, machineOnly = false }) {
  const skipped = [];
  const live = new Map(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => [claim.increment, claim]));
  const held = liveCapabilities(survey.claims, survey.increments);
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
      if (failures.length >= LANE_FAILURES) return `its lanes failed ${failures.length} times (${failures.map((failure) => failure.at).join(", ")}): the pool offers it no more until a session that fixed the cause offers it again (feed.mjs reoffer ${one.id}${one.project && one.project !== "storytree" ? ` --project ${one.project}` : ""} --reason …)`;
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
      if (machineOnly && !one.machine) return "untagged: the shared pool's";
      return undefined;
    })();
    if (why) skipped.push({ id: one.id, why });
    else ready.push(one);
  }
  const refusedOf = Map.groupBy(survey.refusals ?? [], (refusal) => refusal.under);
  const needsOf = (one) => new Set([...(one.capabilities ?? []), ...(refusedOf.get(one.id) ?? []).map((refusal) => refusal.capability)]);
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

const iso = (at) => {
  const time = at == null ? NaN : new Date(at).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
};

export async function readSurvey({ library, claims, refusals = async () => [], failures = async () => [], here = async () => undefined, also = [], closedTitles = false }) {
  const [work, held, name] = await Promise.all([library.workSurvey(new Date(), { also, closedTitles }), claims(), here()]);
  const arcOf = new Map(work.arcs.map((arc) => [arc.id, arc]));
  const byArc = Map.groupBy(work.increments, (record) => record.fields.arc);
  const increments = work.arcs.flatMap((arc) => byArc.get(arc.id) ?? []).map((record) => ({
    id: record.id, arc: record.fields.arc, arcState: arcOf.get(record.fields.arc)?.state, title: record.fields.title,
    status: record.fields.status, capabilities: record.fields.capabilities ?? [], machine: record.fields.machine, parked: record.fields.parked ?? iso(record.createdAt), priority: arcOf.get(record.fields.arc)?.priority,
    ...(record.fields.outcome?.disposition ? { disposition: record.fields.outcome.disposition } : {}),
  }));
  const holds = work.holds({ claimed: new Set(liveCapabilities(held, increments).keys()) });
  const arcs = work.arcs.map((arc) => ({ id: arc.id, state: arc.state, title: arc.title ?? arc.id, created: iso(arc.createdAt), openQuestions: arc.openQuestions }));
  const open = increments.filter((one) => one.status !== "closed" && one.arcState === "active").map((one) => one.id);
  const [refused, failed] = open.length ? await Promise.all([refusals(open), failures(open)]) : [[], []];
  return { arcs, increments, holds, claims: held, here: name, refusals: refused, failures: failed };
}

export async function readBody(library, id) {
  return (await library.get(id))?.fields.body ?? "";
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

export async function surveyLibrary(project = "storytree", { also, closedTitles } = {}) {
  const { openActivityLog, readClaims } = await import("@storytree/session-management");
  const { thisComputer } = await import("@storytree/session-management/machines");
  return withLibrary(project, async (library, storytree) => {
    const log = await openActivityLog(storytree);
    const refusals = async (under) => (await log.lines(project, { kinds: ["claim-refused"], where: { under }, omit: ["reason", "file"] }))
      .map((line) => ({ capability: line.capability, under: line.under, holder: line.holder }));
    return readSurvey({ library, claims: () => readClaims(log, project), refusals, failures: laneFailures(log, project), here: async () => (await thisComputer(storytree)).name, also, closedTitles });
  });
}

export async function incrementBody(id, project = "storytree") {
  return withLibrary(project, (library) => readBody(library, id));
}

export async function surveyProjects(projects, surveyOne, options) {
  const found = await Promise.all(projects.map(async (project) => ({ project, survey: await surveyOne(project, options) })));
  const tagged = (list, project) => (list ?? []).map((one) => ({ ...one, project }));
  const holds = {};
  for (const { survey } of found) for (const [kind, byIncrement] of Object.entries(survey.holds ?? {})) holds[kind] = { ...holds[kind], ...byIncrement };
  return {
    arcs: found.flatMap(({ project, survey }) => tagged(survey.arcs, project)),
    increments: found.flatMap(({ project, survey }) => tagged(survey.increments, project)),
    holds, here: found.map(({ survey }) => survey.here).find(Boolean),
    claims: found.flatMap(({ survey }) => survey.claims ?? []),
    refusals: found.flatMap(({ survey }) => survey.refusals ?? []),
    failures: found.flatMap(({ survey }) => survey.failures ?? []),
  };
}

export const POOL_SESSION = "pool";

const COUNT_KINDS = ["lane-failed", "lane-reoffered"];

function counted(lines) {
  const since = new Map(lines.filter((line) => line.kind === "lane-reoffered").map((line) => [line.increment, line.seq]));
  return lines.filter((line) => line.kind === "lane-failed" && line.seq > (since.get(line.increment) ?? -Infinity));
}

export function laneFailures(log, project) {
  return async (increment) => counted(await log.lines(project, { kinds: COUNT_KINDS, where: { increment }, omit: ["logs"] }))
    .map((line) => ({ increment: line.increment, at: line.at, why: line.why }));
}

export async function noteLaneFailure({ log, project, failure }) {
  const { increment, why, logs, lane, started } = failure;
  if (lane && (await log.lines(project, { kinds: ["claim-refused"], sessions: [lane], ...(started ? { since: started } : {}), newest: 1 })).length) return null;
  await log.append(project, { session: POOL_SESSION, harness: "pool", source: "tool", kind: "lane-failed", increment, why, logs, ...(lane ? { lane } : {}) });
  return counted(await log.lines(project, { kinds: COUNT_KINDS, where: { increment } })).map((line) => ({ increment: line.increment, at: line.at, why: line.why, logs: line.logs }));
}

export async function reoffer({ log, project, increment, why, by }) {
  if (!why?.trim()) throw new Error("say what was fixed: --reason …");
  const cleared = counted(await log.lines(project, { kinds: COUNT_KINDS, where: { increment }, omit: ["logs"] })).length;
  if (!cleared) throw new Error(`${increment} has no failed lane counted against it, so there is nothing to clear`);
  await log.append(project, { session: POOL_SESSION, harness: "pool", source: "tool", kind: "lane-reoffered", increment, why, ...(by ? { by } : {}) });
  return cleared;
}

export async function main(args, { env = process.env, say = console.log, complain = console.error, offer } = {}) {
  const at = args.indexOf("--reason");
  const [verb, increment] = args;
  const why = at >= 0 ? args[at + 1] : undefined;
  const named = args.indexOf("--project");
  const project = named >= 0 ? args[named + 1] : "storytree";
  if (verb !== "reoffer" || !increment || increment.startsWith("--") || !why || !project) {
    complain('usage: feed.mjs reoffer <increment> [--project <name>] --reason "what was fixed"');
    return 2;
  }
  const by = env.CLAUDE_CODE_SESSION_ID || env.CODEX_THREAD_ID || undefined;
  const write = offer ?? (async (request) => {
    const { openActivityLog } = await import("@storytree/session-management");
    return withLibrary(request.project, async (_library, storytree) => reoffer({ log: await openActivityLog(storytree), ...request }));
  });
  try {
    const cleared = await write({ increment, why, by, project });
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

export async function recordLaneFailure(failure, project = "storytree") {
  const { openActivityLog } = await import("@storytree/session-management");
  return withLibrary(project, async (_library, storytree) => noteLaneFailure({ log: await openActivityLog(storytree), project, failure }));
}
