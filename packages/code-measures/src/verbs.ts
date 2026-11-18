/**
 * Capability 1 · Base structure measures, its verb: `storytree code-measures [<story>] [--commit <sha>] [--since <window>]
 * [--json]` (contract 1.7), declared once here (ADR-0969 D2) and named under `verbs` in the package's manifest (ADR-1033),
 * so the command line only mounts it (ADR-0649). It lists the project's stories, reads every one's base measures (or the
 * one named) at the commit without changing the checkout, and prints them, or the same readings as data with --json.
 * Report only (ADR-1354, ADR-1238): no threshold, no verdict, nothing stored, and it answers whatever the readings are.
 */
import { verb, type Verb, type VerbContext, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import { DEFAULT_DAYS } from "./read.js";

const CODE_MEASURES = verb({
  command: {
    family: "code-measures",
    name: "code-measures",
    summary: `each story's base code-structure measures at a commit (report only): size, cognitive complexity and function length tails, duplication, coupling, public surface, type looseness and relative churn over ${DEFAULT_DAYS} days, with comment share as context`,
    usage: "code-measures [<story>] [--commit <sha>] [--since <window>] [--json]",
  },
  tool: { absent: "a report read at the command line over a checkout's Git objects" },
  inputs: {
    story: { kind: "text", word: 0, optional: true, describe: "one story to read, by id or title; every story unless given" },
    commit: { kind: "text", optional: true, describe: "the commit to read; origin/main as last fetched unless given (HEAD where there is no origin)" },
    since: { kind: "text", optional: true, describe: `the churn window ending at the commit, in days (90 or 90d) or weeks (12w); ${DEFAULT_DAYS} days unless given` },
    json: { kind: "switch", describe: "the readings as JSON" },
  },
  async act({ story, commit, since, json }, context: VerbContext) {
    const [{ readStoryMeasures }, { measuresText }] = await Promise.all([import("./read.js"), import("./report.js")]);
    const stories = (await context.library.list("story"))
      .map((record) => {
        const fields = record.fields as { title?: unknown; plugin?: unknown };
        return { id: record.id, title: String(fields.title ?? record.id), ...(typeof fields.plugin === "string" ? { plugin: fields.plugin } : {}) };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    const reading = await readStoryMeasures({ folder: context.folder, stories, ...(story === undefined ? {} : { story }), ...(commit === undefined ? {} : { commit }), ...(since === undefined ? {} : { since }) });
    if (json) return { text: JSON.stringify(reading, null, 2), raw: true };
    return { text: measuresText(reading) };
  },
});

/** The command line's `code-measures` family: its readings are its bare verb. */
export const CODE_MEASURES_FAMILIES: readonly VerbFamily[] = [
  { name: "code-measures", summary: "each story's base code-structure measures at a commit (report only; Code measures')", order: 37.5, verbs: [], bare: CODE_MEASURES as Verb<VerbInputs, VerbContext> },
];
