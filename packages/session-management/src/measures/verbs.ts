// Capability 20 · Lane measures
import type { Storytree } from "@storytree/library";
import { verb, VerbRefusal, type Verb, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import { CATCH_LAYERS, catchRateLines, catchReading, catchText } from "./catch.js";
import type { LaneRow, LaneWindow } from "./lanes.js";
import { MEASURES, type GroupMeasures } from "./summary.js";

interface ProjectRecords {
  readonly name: string;
  reviewRounds?(server: Storytree, project: string, increments: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

export type MeasuresContext = SessionVerbContext & { readonly server?: Storytree; projectRecords?(): Promise<readonly ProjectRecords[]> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 7;

function dayBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function windowOf(from: string | undefined, to: string | undefined, days = DEFAULT_DAYS): { from: string; to: string } {
  const last = to ?? dayBefore(new Date(), 0);
  const first = from ?? dayBefore(new Date(`${last}T00:00:00Z`), days - 1);
  for (const day of [first, last]) if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new VerbRefusal(`"${day}" is not a day: give it as YYYY-MM-DD.`, { misuse: true });
  if (first > last) throw new VerbRefusal(`--from ${first} is after --to ${last}.`, { misuse: true });
  return { from: first, to: last };
}

async function laneReading(context: MeasuresContext, window: LaneWindow): Promise<{ rows: LaneRow[]; stories: GroupMeasures[] }> {
  const [{ laneRows }, { pullFiles }, { groupMeasures }] = await Promise.all([import("./lanes.js"), import("./pull-files.js"), import("./summary.js")]);
  const keeper = (await context.projectRecords?.())?.find((records) => records.reviewRounds !== undefined);
  const server = context.server;
  const rows = await laneRows(context, window, {
    prFiles: await pullFiles(context.folder).catch(() => async () => undefined),
    ...(context.placeFiles === undefined ? {} : { placeFiles: context.placeFiles }),
    ...(keeper?.reviewRounds === undefined || server === undefined ? {} : { reviewRounds: (increments: readonly string[]) => keeper.reviewRounds!(server, context.project, increments) }),
  });
  return { rows, stories: groupMeasures(rows, (row) => row.stories) };
}

export async function storyLaneMeasures(context: MeasuresContext, window: LaneWindow): Promise<GroupMeasures[]> {
  return (await laneReading(context, window)).stories;
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
    const [{ groupMeasures, measuresText }, { rows, stories }] = await Promise.all([import("./summary.js"), laneReading(context, window)]);
    const caught = (await catchReading(context.library, window)).stories;
    if (!json) return { text: [measuresText(rows, window), "", ...catchRateLines(caught)].join("\n") };
    return { text: JSON.stringify({ window, rows, stories, capabilities: groupMeasures(rows, (row) => row.capabilities), catch: caught }, null, 2), raw: true };
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

export const MEASURES_FAMILIES: readonly VerbFamily<MeasuresContext>[] = [
  { name: "measures", summary: "each closed increment's lane cost, review rounds and pass measures, per story and per capability, and where faults were first caught (report only; Session management's)", order: 37, verbs: [CATCH_REPORT as Verb<VerbInputs, MeasuresContext>], bare: MEASURES_REPORT as Verb<VerbInputs, MeasuresContext> },
];
