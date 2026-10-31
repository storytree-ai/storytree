/** Capability 2 · The forest on the site. */
import { pageReading, type BoardReads, type Timers } from "@storytree/arc-surface";
import type { BoardArcView, DayWindow, Line } from "@storytree/library";
import { createKnowledgeCore, type CoreReads } from "@storytree/knowledge-core/view";
import type { SessionsReads } from "@storytree/forest/view";
import type { TourSnapshot } from "./forest-data.js";

/** The app's read-only surfaces receive the saved records, at rest at the recording's end, with the recording's own clock. */
export function savedReading(snapshot: TourSnapshot) {
  // Publication omits private optional fields. No missing field is reconstructed.
  const lines = snapshot.recording.lines as readonly Line[];
  const at = snapshot.recording.window.to;
  // The recording does not move on, so nothing a surface asks to be run again ever falls due.
  const timers: Timers = { now: () => Date.parse(at), every: () => () => {} };
  const arcViews = async () => snapshot.arcs.map(drawn);
  const reads: SessionsReads & BoardReads & CoreReads = {
    projectTree: async () => snapshot.tree,
    arcViews,
    // The arcs drawer's reads (3.12): the live arcs with those closed in the window, or the closed ones alone.
    boardArcs: async (_project, window) => boardViews(await arcViews()).filter(view => view.closed === undefined || within(view, window)),
    closedArcs: async (_project, window) => boardViews(await arcViews()).filter(view => view.closed !== undefined && within(view, window)),
    holds: async () => snapshot.holds,
    changesSince: async (_project, cursor) => ({ changes: snapshot.changes.filter(change => change.seq > cursor), cursor: snapshot.changes.at(-1)?.seq ?? cursor }),
    linesSince: async (_project, cursor) => ({ lines: lines.filter(line => line.seq > cursor), cursor: lines.at(-1)?.seq ?? cursor }),
    windowReading: async (_project, session) => ({ session, at, absent: "Transcript windows were not included in this public recording." }),
  };
  const reading = pageReading({ project: snapshot.project, reads, timers });
  return { reads, reading, timers, lines, now: () => new Date(at) };
}

/**
 * A saved reading with its own knowledge core hearing it. The core reads a picked session's window from the recording, which
 * answers it absent, so the session's reading path is drawn (ADR-0756).
 */
export function recordedView(snapshot: TourSnapshot) {
  const recording = savedReading(snapshot);
  const core = createKnowledgeCore(snapshot.project, { reads: recording.reads });
  const stopHearing = recording.reading.subscribe({ onNews: news => core.take(snapshot.changes, news.lines) });
  return { recording, core, stop() { stopHearing(); core.dispose(); recording.reading.stop(); } };
}

/**
 * A saved arc as the board reads it. The saved reading keeps no intent, so the arc's title stands in, and an increment's
 * close is saved as its disposition and pull request alone, which the board reads as its outcome.
 */
function drawn(view: TourSnapshot["arcs"][number]): TourSnapshot["arcs"][number] {
  type Close = { disposition?: string; pr?: string };
  return {
    ...view,
    arc: { ...view.arc, fields: { ...view.arc.fields, intent: view.arc.fields.intent ?? view.arc.fields.title } },
    increments: view.increments.map(increment => {
      const { disposition, pr, ...fields } = increment.fields as typeof increment.fields & Close;
      return disposition === undefined && pr === undefined ? increment : { ...increment, fields: { ...fields, outcome: { ...increment.fields.outcome, ...(disposition === undefined ? {} : { disposition }), ...(pr === undefined ? {} : { pr }) } } } as typeof increment;
    }),
  };
}

/** The arcs as the board reads them: each closed one with its closing day, its increments' latest outcome day. */
function boardViews(arcs: TourSnapshot["arcs"]): BoardArcView[] {
  return arcs.map(view => view.state !== "closed" ? view : { ...view, closed: view.increments.map(({ fields }) => fields.outcome?.date ?? "").sort().at(-1) ?? "" });
}
const within = ({ closed }: BoardArcView, { from, to }: DayWindow) => closed !== undefined && closed >= from && closed < to;
