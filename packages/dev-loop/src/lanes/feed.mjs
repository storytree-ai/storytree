// Capability 11 · The Mint pool keeps its lanes fed (ADR-0955 D2): one survey of the library names every active
// arc's ready increments, under the manager's skip rules, and claims are the only conflict guard.

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

/** An increment's place by its arc's priority (ADR-0963 D1): 1 first, an arc with none after every ranked one. */
const rank = (one) => one.priority ?? Infinity;

/**
 * The pool's next `max` increments from one survey (ADR-0955 D2), and why each other was skipped. A candidate is
 * not closed, sits on an active arc, has no live claim on it or on a capability its list names (directly, or on the list of an
 * increment a live session holds), no capability its lane was refused while the session that refused it still holds it, no wait or held-on
 * question (only those say it needs the owner; its body's wording never does), its machine field, when set, names this
 * machine (`survey.here`), and its needs clause names no other machine (until every such increment carries the field); no fence or track is read. By arc priority, then oldest parked first, and within one priority
 * those on an arc no live session (nor a pick already made) is on before the rest (ADR-0963 D2). `running` names the increments this dispatcher is running, never started
 * twice; `attempts` maps each increment this dispatcher has started to when it started it: a live claim older than that start
 * (on it, on a listed capability or on one its lane was refused) refused it, and it is retried only once that claim clears (it records the refusal in `attempts`). Work whose session has
 * ended and is back in the pool (it bounced on a capability claim, say) is offered again `backoffMs` after the first
 * survey that found the session gone (it records that in `attempts` as `ended`), so a bounce needs no restart and a
 * session that bounces every time starts at most once a back-off.
 */
export function pickPool(survey, { attempts = new Map(), running = [], max = 1, now = Date.now(), backoffMs = 30 * 60_000 }) {
  const skipped = [];
  const live = new Map(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => [claim.increment, claim]));
  // A capability on the list of an increment a live session holds is held too, as the edit gate reads it (ADR-0949 D3); a direct claim names it first.
  const listOf = new Map(survey.increments.map((one) => [one.id, one.capabilities ?? []]));
  const liveCapabilities = new Map([...live.values()].flatMap((claim) => (listOf.get(claim.increment) ?? []).map((capability) => [capability, { ...claim, capability, on: claim.increment }])));
  for (const claim of survey.claims) if (claim.holder === "live" && claim.capability) liveCapabilities.set(claim.capability, claim);
  // A lane refused a capability before it was on the list is held off by that refusal while its holder keeps the capability.
  const refusedUnder = Map.groupBy((survey.refusals ?? []).filter((refusal) => liveCapabilities.get(refusal.capability)?.session === refusal.holder), (refusal) => refusal.under);
  const arcOf = new Map(survey.increments.map((one) => [one.id, one.arc]));
  const busy = new Set([...live.keys(), ...running].map((id) => arcOf.get(id)).filter(Boolean));
  const ready = [];
  const candidates = survey.increments.filter((one) => one.status !== "closed" && one.arcState === "active")
    .sort((a, b) => rank(a) - rank(b) || String(a.parked).localeCompare(String(b.parked)));
  for (const one of candidates) {
    const why = (() => {
      if (running.includes(one.id)) return "running now";
      const attempt = attempts.get(one.id);
      const claim = live.get(one.id);
      if (claim) {
        if (attempt && !attempt.refusedBy && Date.parse(claim.since) < attempt.at) attempt.refusedBy = claim.session;
        return `held by live session ${claim.session}`;
      }
      const held = (one.capabilities ?? []).map((capability) => liveCapabilities.get(capability)).filter(Boolean);
      if (held.length) {
        if (attempt && !attempt.refusedBy && held.some((hold) => Date.parse(hold.since) < attempt.at)) attempt.refusedBy = held[0].session;
        return held.map((hold) => `${hold.capability} held by live session ${hold.session}${hold.on ? ` on the list of ${hold.on}` : ""}`).join("; ");
      }
      const refused = (refusedUnder.get(one.id) ?? []).map((refusal) => liveCapabilities.get(refusal.capability));
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
      if (/\b(?:laptop|another machine)\b/i.test(needs(one.body))) return "needs another machine";
      return undefined;
    })();
    if (why) skipped.push({ id: one.id, why });
    else ready.push(one);
  }
  const picks = [];
  while (picks.length < max && ready.length) {
    const idle = ready.findIndex((one) => !busy.has(one.arc));
    const at = idle > 0 && rank(ready[idle]) !== rank(ready[0]) ? 0 : Math.max(0, idle);
    const [one] = ready.splice(at, 1);
    busy.add(one.arc);
    picks.push(one);
  }
  return { picks, skipped };
}

/**
 * The arc a planning session should take when nothing is ready (ADR-0955 D4): an active arc with no open question and no open increment that is unwaited (every one waits on work, an event or a question),
 * oldest first, skipping the arcs in `planned` (those this dispatcher has planned already). Undefined when none qualifies.
 * Work handed to the watcher, or waiting on work that is (at any depth), is in flight like claimed work, not stalled.
 */
export function pickPlan(survey, { planned = new Set() } = {}) {
  const live = new Set(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => claim.increment));
  const handed = (id, seen = new Set()) => !seen.has(id) && (seen.add(id), (survey.holds.waitsFor?.[id] ?? []).some((hold) => hold.holds && HANDED.test(hold.note))
    || (survey.holds.waits[id] ?? []).some((hold) => handed(hold.on, seen)));
  const waited = (id) => !live.has(id) && !handed(id) && ((survey.holds.waits[id] ?? []).length > 0 || (survey.holds.heldOn[id] ?? []).length > 0
    || (survey.holds.waitsFor?.[id] ?? []).some((hold) => hold.holds));
  const open = Map.groupBy(survey.increments.filter((one) => one.status !== "closed"), (one) => one.arc);
  return (survey.arcs ?? []).filter((arc) => arc.state === "active" && !planned.has(arc.id) && !arc.openQuestions
    && (open.get(arc.id) ?? []).every((one) => waited(one.id)))
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))[0];
}

/**
 * One survey of the library: every arc with its open questions counted, its increments with their holds and machine fields (one `arcViews` and one `holds` read),
 * this machine's short name (`here`, undefined while it has none), the standing claims,
 * and the capability refusals their live holders gave, each under the increment its refused session held (`refusals`, given the live holders' sessions).
 */
export async function readSurvey({ library, claims, refusals = async () => [], here = async () => undefined }) {
  const [views, holds, held, name] = await Promise.all([library.arcViews(), library.holds(), claims(), here()]);
  const holders = [...new Set(held.filter((claim) => claim.holder === "live").map((claim) => claim.session))];
  const increments = views.flatMap((view) => view.increments.map((record) => ({
    id: record.id, arc: view.arc.id, arcState: view.state, title: record.fields.title, body: record.fields.body ?? "",
    status: record.fields.status, capabilities: record.fields.capabilities ?? [], machine: record.fields.machine, parked: record.fields.parked ?? record.createdAt?.toISOString?.(), priority: view.arc.fields?.priority,
  })));
  const arcs = views.map((view) => ({
    id: view.arc.id, state: view.state, title: view.arc.fields?.title ?? view.arc.id, created: view.arc.createdAt?.toISOString?.(),
    openQuestions: (view.questions ?? []).filter((question) => question.fields.lifecycle === "open").length,
  }));
  return { arcs, increments, holds, claims: held, here: name, refusals: holders.length ? await refusals(holders) : [] };
}

async function withLibrary(project, use) {
  const { locateLibrary } = await import("@storytree/session-management");
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
    const refusals = async (holders) => (await log.lines(project, { kinds: ["claim-refused"], has: ["capability", "under"], where: { holder: holders }, omit: ["reason", "file"] }))
      .map((line) => ({ capability: line.capability, under: line.under, holder: line.holder }));
    return readSurvey({ library, claims: () => readClaims(log, project), refusals, here: async () => (await thisComputer(storytree)).name });
  });
}
