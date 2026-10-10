// Capability 11 · The Mint pool keeps its lanes fed (ADR-0955 D2): one survey of the library names every active
// arc's ready increments, under the manager's skip rules, and claims are the only conflict guard.

/** The website arc: its work is the laptop's (the manager's skip rule). */
export const WEBSITE_ARC = "arc_e42da2528db8";

/** Work whose needs line says read-only: it writes no package, whatever packages it reads. */
export function readOnly(body) {
  return (body.match(/\bneeds:[^\n]*/gi) ?? []).some((line) => /\bread-only\b/i.test(line));
}

/** Work whose needs line says blind: a blind reviewer's (ADR-0950). */
export function blind(body) {
  return (body.match(/\bneeds:[^\n]*/gi) ?? []).some((line) => /\bblind\b/i.test(line));
}

/** An increment's place by its arc's priority (ADR-0963 D1): 1 first, an arc with none after every ranked one. */
const rank = (one) => one.priority ?? Infinity;

/**
 * The pool's next `max` increments from one survey (ADR-0955 D2), and why each other was skipped. A candidate is
 * not closed, sits on an active arc, has no live claim, wait or held-on question, and needs neither the owner nor
 * another machine; no fence or track is read. By arc priority, then oldest parked first, and within one priority
 * those on an arc no live session (nor a pick already made) is on before the rest (ADR-0963 D2). `running` names the increments this dispatcher is running, never started
 * twice; `attempts` maps each increment this dispatcher has started to when it started it: a live claim older than that start
 * refused it, and it is retried only once that claim clears (it records the refusal in `attempts`). Work whose session has
 * ended and is back in the pool (it bounced on a capability claim, say) is offered again `backoffMs` after the first
 * survey that found the session gone (it records that in `attempts` as `ended`), so a bounce needs no restart and a
 * session that bounces every time starts at most once a back-off.
 */
export function pickPool(survey, { attempts = new Map(), running = [], max = 1, now = Date.now(), backoffMs = 30 * 60_000 }) {
  const skipped = [];
  const live = new Map(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => [claim.increment, claim]));
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
      if (one.arc === WEBSITE_ARC) return "on the website arc";
      const needs = (one.body.match(/\bneeds:[^\n]*/gi) ?? []).join("\n");
      if (/\bowner\b/i.test(needs) || /\bowner action\b/i.test(one.body)) return "needs an owner action";
      if (/\b(?:laptop|another machine)\b/i.test(needs)) return "needs another machine";
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
 * The arc a planning session should take when nothing is ready (ADR-0955 D4): an active arc, not the website arc,
 * with no open question and no open increment that is unwaited (every one waits on work, an event or a question),
 * oldest first, skipping the arcs in `planned` (those this dispatcher has planned already). Undefined when none qualifies.
 */
export function pickPlan(survey, { planned = new Set() } = {}) {
  const live = new Set(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => claim.increment));
  const waited = (id) => !live.has(id) && ((survey.holds.waits[id] ?? []).length > 0 || (survey.holds.heldOn[id] ?? []).length > 0
    || (survey.holds.waitsFor?.[id] ?? []).some((hold) => hold.holds));
  const open = Map.groupBy(survey.increments.filter((one) => one.status !== "closed"), (one) => one.arc);
  return (survey.arcs ?? []).filter((arc) => arc.state === "active" && arc.id !== WEBSITE_ARC && !planned.has(arc.id) && !arc.openQuestions
    && (open.get(arc.id) ?? []).every((one) => waited(one.id)))
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))[0];
}

/** One survey of the library: every arc with its open questions counted, its increments with their holds (one `arcViews` and one `holds` read), and the standing claims. */
export async function readSurvey({ library, claims }) {
  const [views, holds, held] = await Promise.all([library.arcViews(), library.holds(), claims()]);
  const increments = views.flatMap((view) => view.increments.map((record) => ({
    id: record.id, arc: view.arc.id, arcState: view.state, title: record.fields.title, body: record.fields.body ?? "",
    status: record.fields.status, parked: record.fields.parked ?? record.createdAt?.toISOString?.(), priority: view.arc.fields?.priority,
  })));
  const arcs = views.map((view) => ({
    id: view.arc.id, state: view.state, title: view.arc.fields?.title ?? view.arc.id, created: view.arc.createdAt?.toISOString?.(),
    openQuestions: (view.questions ?? []).filter((question) => question.fields.lifecycle === "open").length,
  }));
  return { arcs, increments, holds, claims: held };
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
  const { openActivityLog, readClaims } = await import("@storytree/agent-link");
  return withLibrary(project, async (library, storytree) => {
    const log = await openActivityLog(storytree);
    return readSurvey({ library, claims: () => readClaims(log, project) });
  });
}
