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

/**
 * The pool's next `max` increments from one survey (ADR-0955 D2), and why each other was skipped. A candidate is
 * not closed, sits on an active arc, has no live claim, wait or held-on question, and needs neither the owner nor
 * another machine; no fence or track is read. Oldest parked first, those on an arc no live session (nor a pick
 * already made) is on before the rest. `running` names the increments this dispatcher is running, never started
 * twice; `attempts` maps each increment this dispatcher has started to when it started it: a live claim older than that start
 * refused it, and it is retried only once that claim clears (it records the refusal in `attempts`), never otherwise.
 */
export function pickPool(survey, { attempts = new Map(), running = [], max = 1 }) {
  const skipped = [];
  const live = new Map(survey.claims.filter((claim) => claim.holder === "live" && claim.increment).map((claim) => [claim.increment, claim]));
  const arcOf = new Map(survey.increments.map((one) => [one.id, one.arc]));
  const busy = new Set([...live.keys(), ...running].map((id) => arcOf.get(id)).filter(Boolean));
  const ready = [];
  const candidates = survey.increments.filter((one) => one.status !== "closed" && one.arcState === "active")
    .sort((a, b) => String(a.parked).localeCompare(String(b.parked)));
  for (const one of candidates) {
    const why = (() => {
      if (running.includes(one.id)) return "running now";
      const attempt = attempts.get(one.id);
      const claim = live.get(one.id);
      if (claim) {
        if (attempt && !attempt.refusedBy && Date.parse(claim.since) < attempt.at) attempt.refusedBy = claim.session;
        return `held by live session ${claim.session}`;
      }
      if (attempt && !attempt.refusedBy) return "already run by this dispatcher";
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
    const at = Math.max(0, ready.findIndex((one) => !busy.has(one.arc)));
    const [one] = ready.splice(at, 1);
    busy.add(one.arc);
    picks.push(one);
  }
  return { picks, skipped };
}

/** One survey of the library: every arc's increments with their holds (one `arcViews` and one `holds` read), and the standing claims. */
export async function readSurvey({ library, claims }) {
  const [views, holds, held] = await Promise.all([library.arcViews(), library.holds(), claims()]);
  const increments = views.flatMap((view) => view.increments.map((record) => ({
    id: record.id, arc: view.arc.id, arcState: view.state, title: record.fields.title, body: record.fields.body ?? "",
    status: record.fields.status, parked: record.fields.parked ?? record.createdAt?.toISOString?.(),
  })));
  return { increments, holds, claims: held };
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
