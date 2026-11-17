/**
 * Capability 20 · Lane measures, its verbs: `storytree measures` (contracts 20.1, 20.2, 20.6) and `storytree measures catch`
 * (20.5), declared once here (ADR-0969 D2) and named under `verbs` in the package's manifest (ADR-1033). The bare verb joins
 * each closed increment's lane to its cost, review rounds and pass measures and prints them per story and per capability,
 * with each story's catch rate by layer beside them; `catch` prints the whole catch reading; both read one window. The
 * door hands what Session management may not read itself: the map's placement of files (`placeFiles`), and the review
 * rounds of whichever mounted part keeps a QA ledger, as that part's project-records contribution offers them
 * (`reviewRounds`, beside its `forget`; ADR-1170 D2), the shape restated here rather than imported (ADR-1017 D2). Neither
 * is a tool: each is a report read at the command line, where those parts are mounted. Report only (ADR-1238).
 */
import type { Storytree } from "@storytree/library";
import { verb, VerbRefusal, type Verb, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import { CATCH_LAYERS, catchRateLines, catchReading, catchText } from "./catch.js";
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

/** The window `--from` and `--to` give, each a real day and in order: to today unless given, and from DEFAULT_DAYS days ending there. */
function windowOf(from: string | undefined, to: string | undefined): { from: string; to: string } {
  const last = to ?? dayBefore(new Date(), 0);
  const first = from ?? dayBefore(new Date(`${last}T00:00:00Z`), DEFAULT_DAYS - 1);
  for (const day of [first, last]) if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new VerbRefusal(`"${day}" is not a day: give it as YYYY-MM-DD.`, { misuse: true });
  if (first > last) throw new VerbRefusal(`--from ${first} is after --to ${last}.`, { misuse: true });
  return { from: first, to: last };
}

const MEASURES_REPORT = verb({
  command: {
    family: "measures",
    name: "measures",
    summary: `each closed increment's lane cost, review rounds and pass measures, per story and per capability, and each story's catch rate by layer (as \`measures catch\` reads it; report only). Per lane: ${MEASURES.map((measure) => `${measure.name}, ${measure.means}`).join("; ")}`,
    usage: "measures [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]",
  },
  tool: { absent: "a report read at the command line, where the part keeping the QA ledger hands in its review rounds" },
  inputs: {
    from: { kind: "text", optional: true, describe: `the first day closings count from (UTC); ${DEFAULT_DAYS} days before the last unless given` },
    to: { kind: "text", optional: true, describe: "the last day closings count to (UTC); today unless given" },
    json: { kind: "switch", describe: "every lane's joined row and the per story and per capability measures, as JSON" },
  },
  async act({ from, to, json }, context: MeasuresContext) {
    const window = windowOf(from, to);
    const [{ laneRows }, { pullFiles }, { groupMeasures, measuresText }] = await Promise.all([import("./lanes.js"), import("./pull-files.js"), import("./summary.js")]);
    const keeper = (await context.projectRecords?.())?.find((records) => records.reviewRounds !== undefined);
    const server = context.server;
    const rows = await laneRows(context, window, {
      prFiles: await pullFiles(context.folder).catch(() => async () => undefined),
      ...(context.placeFiles === undefined ? {} : { placeFiles: context.placeFiles }),
      ...(keeper?.reviewRounds === undefined || server === undefined ? {} : { reviewRounds: (increments: readonly string[]) => keeper.reviewRounds!(server, context.project, increments) }),
    });
    const caught = (await catchReading(context.library, window)).stories;
    if (!json) return { text: [measuresText(rows, window), "", ...catchRateLines(caught)].join("\n") };
    return { text: JSON.stringify({ window, rows, stories: groupMeasures(rows, (row) => row.stories), capabilities: groupMeasures(rows, (row) => row.capabilities), catch: caught }, null, 2), raw: true };
  },
});

const CATCH_REPORT = verb({
  command: {
    family: "measures",
    name: "catch",
    summary: `where faults were first caught, by layer (report only): the field reading, escape patterns harvested in the window caught by CI or escaped, and the drill reading, each layer's first catches and not-run counts over the red team's drills dated in it, overall, per pattern and per story, a reviewer's catches by the planter's model counted same-model. The layers, earliest to latest: ${CATCH_LAYERS.map((layer) => `${layer.name}, ${layer.means}`).join("; ")}`,
    usage: "measures catch [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]",
  },
  tool: { absent: "a report read at the command line, beside the lane measures" },
  inputs: {
    from: { kind: "text", optional: true, describe: `the first day harvests and drills count from (UTC); ${DEFAULT_DAYS} days before the last unless given` },
    to: { kind: "text", optional: true, describe: "the last day harvests and drills count to (UTC); today unless given" },
    json: { kind: "switch", describe: "the window and the catch reading, as JSON" },
  },
  async act({ from, to, json }, context: MeasuresContext) {
    const window = windowOf(from, to);
    const reading = await catchReading(context.library, window);
    if (!json) return { text: catchText(reading, window) };
    return { text: JSON.stringify({ window, ...reading }, null, 2), raw: true };
  },
});

/** The command line's `measures` family: the lane report, and the catch reading. */
export const MEASURES_FAMILIES: readonly VerbFamily<MeasuresContext>[] = [
  { name: "measures", summary: "each closed increment's lane cost, review rounds and pass measures, per story and per capability, and where faults were first caught (report only; Session management's)", order: 37, verbs: [CATCH_REPORT as Verb<VerbInputs, MeasuresContext>], bare: MEASURES_REPORT as Verb<VerbInputs, MeasuresContext> },
];
