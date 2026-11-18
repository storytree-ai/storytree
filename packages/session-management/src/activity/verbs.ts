// Capability 2 · Agent activity log
import { verb, VerbRefusal, type Verb, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import type { SessionVerbContext } from "../sessions/verbs.js";
import { thisMachine } from "./activity-log.js";
import { freshnessMs, readTwoMachines } from "./observe.js";

const FRESHNESS = "2d";

const observe = verb({
  command: { family: "activity", name: "observe", summary: "whether two or more machines wrote this project's activity log lately and their latest lines read back in order; --record <contract> records it as that contract's live reading", usage: "activity observe [--freshness 2d] [--record <contract>]" },
  tool: { absent: "the Mint box's scheduled run takes it from the command line, as a person checking it does" },
  writes: true,
  inputs: {
    freshness: { kind: "text", optional: true, describe: "how far back the machines must have written, as 36h or 2d; 2d unless given, and the contract's own with --record" },
    record: { kind: "text", optional: true, describe: "a contract proved by observability as proof, to record the reading as its live reading" },
  },
  async act({ freshness: given, record }, context: SessionVerbContext) {
    const proof = record === undefined ? undefined : await proofOf(context, record);
    if (proof !== undefined && given !== undefined) throw new VerbRefusal(`${record}'s proof names its own freshness (${proof.freshness}): leave --freshness out with --record.`, { misuse: true });
    const freshness = proof?.freshness ?? given ?? FRESHNESS;
    if (freshnessMs(freshness) === undefined) throw new VerbRefusal(`"${freshness}" is no freshness: give a whole number of hours or days, as 36h or 2d.`, { misuse: true });
    const reading = await readTwoMachines(context.log, context.project, freshness);
    if (record !== undefined) await context.library.recordObserved(record, reading.state, { machine: thisMachine() ?? "unknown", evidence: reading.evidence, ...context.writer });
    return {
      text: `${reading.state}: ${reading.evidence}${record === undefined ? "" : `. Recorded as ${record}'s live reading.`}`,
      data: { state: reading.state, freshness, machines: reading.machines, ...(record === undefined ? {} : { recorded: record }) },
    };
  },
});

async function proofOf(context: SessionVerbContext, id: string): Promise<{ freshness: string }> {
  const record = await context.library.get(id);
  if (record === null || record === undefined || record.type !== "contract") throw new VerbRefusal(`${id} is no contract: give the id of a contract proved by observability as proof.`);
  const proof = (record.fields as { proof?: { by: string; freshness?: string } }).proof;
  if (proof?.by !== "observability-as-proof" || proof.freshness === undefined) throw new VerbRefusal(`${id} is not proved by observability as proof, so a live reading does not prove it: its proof is ${proof?.by ?? "unstated"}.`);
  return { freshness: proof.freshness };
}

export const ACTIVITY_VERBS: readonly Verb<VerbInputs, SessionVerbContext>[] = [observe];

export const ACTIVITY_FAMILIES: readonly VerbFamily<SessionVerbContext>[] = [
  { name: "activity", summary: "whether the machines sharing this project's library share its activity log (the Mint box's live reading for contract 2.5)", order: 24.6, verbs: ACTIVITY_VERBS },
];
