/**
 * Capability 18 · Scheduled processes: the cheap checks a process's `precheck` names (the library's fixed list,
 * PRECHECKS), each read here before its runner starts a subagent. Each says whether there is work, and what it found;
 * one that wrongly found nothing would hide work, so `schedule ran` records a skip only on a fresh reading.
 */
import type { Library, Precheck } from "@storytree/library";

/** What a precheck found: work to do, or nothing, in a line that says why. */
export type PrecheckReading = { readonly work: boolean; readonly found: string };

const READS: Readonly<Record<Precheck, (library: Library) => Promise<PrecheckReading>>> = {
  async "feedback-waiting"(library) {
    const waiting = (await library.list("feedback")).filter((note) => note.fields.status === "new").length;
    return waiting === 0 ? { work: false, found: "no feedback note waits to be routed" } : { work: true, found: `${waiting} feedback note${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""} to be routed` };
  },
  // The assistant pass's work (18.4, ADR-1231): an open question on an active arc with no prep mark, or reworded after
  // it, to prep; a settled one carrying a would-be answer and no score, to score.
  async "questions-to-prep"(library) {
    const [questions, predictions] = await Promise.all([library.list("question"), library.list("prediction")]);
    const unprepped = questions.filter(({ fields }) => fields.lifecycle === "open" && (fields.prep === undefined || fields.prep.editedAt !== undefined));
    const views = await Promise.all([...new Set(unprepped.map(({ fields }) => fields.arc))].map((arc) => library.arcView(arc)));
    const active = new Set(views.flatMap((view) => (view?.state === "active" ? [view.arc.id] : [])));
    const toPrep = unprepped.filter(({ fields }) => active.has(fields.arc)).map(({ id }) => id);
    const predicted = new Set(predictions.map(({ fields }) => fields.question));
    const toScore = questions.filter(({ id, fields }) => fields.lifecycle === "settled" && fields.score === undefined && predicted.has(id)).map(({ id }) => id);
    if (toPrep.length + toScore.length === 0) return { work: false, found: "no question waits to be prepped or scored" };
    // The ids, so the prep session takes these and no others: no list names a settled question waiting for its score.
    const named = (ids: readonly string[], what: string): string[] => (ids.length === 0 ? [] : [`${ids.length} question${ids.length === 1 ? "" : "s"} to ${what} (${ids.join(", ")})`]);
    return { work: true, found: [...named(toPrep, "prep"), ...named(toScore, "score")].join(" and ") };
  },
};

/** Read the precheck named, against `library`. */
export function readPrecheck(precheck: Precheck, library: Library): Promise<PrecheckReading> {
  return READS[precheck](library);
}
