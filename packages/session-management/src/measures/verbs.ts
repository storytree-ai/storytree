/**
 * Capability 20 · Lane measures, its verb: `storytree measures` (contracts 20.1, 20.2), declared once here (ADR-0969
 * D2) and named under `verbs` in the package's manifest (ADR-1033). It joins each closed increment's lane to its cost,
 * review rounds and pass measures and prints them per story and per capability. The door hands what Session management
 * may not read itself: the map's placement of files (`placeFiles`), and the review rounds of whichever mounted part keeps
 * a QA ledger, as that part's project-records contribution offers them (`reviewRounds`, beside its `forget`; ADR-1170 D2),
 * the shape restated here rather than imported (ADR-1017 D2). It is not a tool: it is a report read at the command line,
 * where those parts are mounted. Report only (ADR-1238).
 */
import type { Storytree } from "@storytree/library";
import { verb, VerbRefusal, type Verb, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import { MEASURES } from "./summary.js";

/** Records a mounted part keeps for a project outside its library; one that keeps a QA ledger may also say each increment's review rounds. */
interface ProjectRecords {
  readonly name: string;
  reviewRounds?(server: Storytree, project: string, increments: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

/** The context the verb reads: the session context, with what the command line's door adds. */
type MeasuresContext = SessionVerbContext & { readonly server?: Storytree; projectRecords?(): Promise<readonly ProjectRecords[]> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 7;

/** The UTC day `days` before `now`, as YYYY-MM-DD. */
function dayBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

const MEASURES_REPORT = verb({
  command: {
    family: "measures",
    name: "measures",
    summary: `each closed increment's lane cost, review rounds and pass measures, per story and per capability (report only). Per lane: ${MEASURES.map((measure) => `${measure.name}, ${measure.means}`).join("; ")}`,
    usage: "measures [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]",
  },
  tool: { absent: "a report read at the command line, where the part keeping the QA ledger hands in its review rounds" },
  inputs: {
    from: { kind: "text", optional: true, describe: `the first day closings count from (UTC); ${DEFAULT_DAYS} days before the last unless given` },
    to: { kind: "text", optional: true, describe: "the last day closings count to (UTC); today unless given" },
    json: { kind: "switch", describe: "every lane's joined row and the per story and per capability measures, as JSON" },
  },
  async act({ from, to, json }, context: MeasuresContext) {
    const last = to ?? dayBefore(new Date(), 0);
    const first = from ?? dayBefore(new Date(`${last}T00:00:00Z`), DEFAULT_DAYS - 1);
    for (const day of [first, last]) if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new VerbRefusal(`"${day}" is not a day: give it as YYYY-MM-DD.`, { misuse: true });
    if (first > last) throw new VerbRefusal(`--from ${first} is after --to ${last}.`, { misuse: true });
    const [{ laneRows }, { pullFiles }, { groupMeasures, measuresText }] = await Promise.all([import("./lanes.js"), import("./pull-files.js"), import("./summary.js")]);
    const keeper = (await context.projectRecords?.())?.find((records) => records.reviewRounds !== undefined);
    const server = context.server;
    const window = { from: first, to: last };
    const rows = await laneRows(context, window, {
      prFiles: await pullFiles(context.folder).catch(() => async () => undefined),
      ...(context.placeFiles === undefined ? {} : { placeFiles: context.placeFiles }),
      ...(keeper?.reviewRounds === undefined || server === undefined ? {} : { reviewRounds: (increments: readonly string[]) => keeper.reviewRounds!(server, context.project, increments) }),
    });
    if (!json) return { text: measuresText(rows, window) };
    return { text: JSON.stringify({ window, rows, stories: groupMeasures(rows, (row) => row.stories), capabilities: groupMeasures(rows, (row) => row.capabilities) }, null, 2), raw: true };
  },
});

/** The command line's `measures` family: the report alone. */
export const MEASURES_FAMILIES: readonly VerbFamily<MeasuresContext>[] = [
  { name: "measures", summary: "each closed increment's lane cost, review rounds and pass measures, per story and per capability (report only; Session management's)", order: 37, verbs: [], bare: MEASURES_REPORT as Verb<VerbInputs, MeasuresContext> },
];
