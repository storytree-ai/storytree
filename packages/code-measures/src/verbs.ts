/**
 * Capability 1 · Base structure measures, its verb: `storytree code-measures [<story>] [--commit <sha>] [--since <window>]
 * [--json]` (contract 1.7), declared once here (ADR-0969 D2) and named under `verbs` in the package's manifest (ADR-1033),
 * so the command line only mounts it (ADR-0649). It lists the project's stories, reads every one's base measures (or the
 * one named) at the commit without changing the checkout, and prints them, or the same readings as data with --json.
 * Report only (ADR-1354, ADR-1238): no threshold, no verdict, nothing stored, and it answers whatever the readings are.
 */
import type { Library } from "@storytree/library";
import { verb, VerbRefusal, type Verb, type VerbContext, type VerbFamily, type VerbInputs } from "@storytree/library/verbs";

import { DEFAULT_DAYS } from "./read.js";

const OVER_TIME_DAYS = 30;

async function storiesOf(library: Library): Promise<{ id: string; title: string; plugin?: string }[]> {
  return (await library.list("story"))
    .map((record) => {
      const fields = record.fields as { title?: unknown; plugin?: unknown };
      return { id: record.id, title: String(fields.title ?? record.id), ...(typeof fields.plugin === "string" ? { plugin: fields.plugin } : {}) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

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
    const reading = await readStoryMeasures({ folder: context.folder, stories: await storiesOf(context.library), ...(story === undefined ? {} : { story }), ...(commit === undefined ? {} : { commit }), ...(since === undefined ? {} : { since }) });
    if (json) return { text: JSON.stringify(reading, null, 2), raw: true };
    return { text: measuresText(reading) };
  },
});

/**
 * Capability 2 · Measures paired with their readers, its verb: `storytree code-measures pair [--json]` (contract 2.2). It
 * reads the project's live measure records and the checkout's workspace packages' readers, prints each story's measures
 * paired, or unpaired with why, and is refused naming the count when any does not pair; with nothing to pair it says so.
 */
const PAIR = verb({
  command: {
    family: "code-measures",
    name: "pair",
    summary: "each story's measure records paired with the readers its packages declare; refused when any does not pair",
    usage: "code-measures pair [--json]",
  },
  tool: { absent: "a check read at the command line over a checkout's packages" },
  inputs: {
    json: { kind: "switch", describe: "the pairing as JSON" },
  },
  async act({ json }, context: VerbContext) {
    const { measureReadersOf, pairMeasures, pairingText } = await import("./pair.js");
    const [records, readers, stories] = await Promise.all([context.library.measures(), measureReadersOf(context.folder), context.library.list("story")]);
    const pairings = pairMeasures(records.map(({ id, fields }) => ({ id, fields })), readers);
    if (json) return { text: JSON.stringify(pairings, null, 2), raw: true };
    const titles = new Map<string, string>([...stories, ...records].map(({ id, fields }) => [id, String((fields as { title?: unknown }).title ?? id)]));
    const text = pairingText(pairings, titles);
    const count = pairings.reduce((sum, { unpaired }) => sum + unpaired.length, 0);
    if (count > 0) throw new VerbRefusal(`${text}\n\n${count} measure${count === 1 ? " does" : "s do"} not pair with one reader at its version in its story's package.`);
    return { text };
  },
});

const RECORD = verb({
  command: {
    family: "code-measures",
    name: "record",
    summary: "record every story's base measures read on this machine at origin/main, in the readings kept beside the library: once a head, at most once a day",
    usage: "code-measures record --machine <name>",
  },
  tool: { absent: "a step for the Mint box's scheduled recording, run at the command line over a checkout" },
  inputs: {
    machine: { kind: "text", optional: true, describe: "the machine recording: the base measures whose machine is this name are read" },
  },
  async act({ machine }, context: VerbContext) {
    if (machine === undefined) throw new VerbRefusal("Give --machine <name>: the machine whose base measures this records.", { misuse: true });
    if (context.server === undefined) throw new VerbRefusal("Measure readings are kept beside the library, and this door has no library server open.");
    const [{ measureReadersOf }, { recordMeasures }, { measureReadingsPool }] = await Promise.all([import("./pair.js"), import("./record.js"), import("./readings.js")]);
    const [records, readers, stories] = await Promise.all([context.library.measures(), measureReadersOf(context.folder), storiesOf(context.library)]);
    const db = await measureReadingsPool(context.server);
    return { text: await recordMeasures({ folder: context.folder, project: context.project, machine, stories, records: records.map(({ id, fields }) => ({ id, fields })), readers, db, plan: () => context.library.projectTree() }) };
  },
});

const STORY = verb({
  command: {
    family: "code-measures",
    name: "story",
    summary: "each story's base and dedicated measures over a window of committed days, each latest reading against the natural process limits of the earlier ones, with the story's lane cost beside them (report only)",
    usage: "code-measures story [<story>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]",
  },
  tool: { absent: "a report read at the command line over the readings kept beside the library" },
  inputs: {
    story: { kind: "text", word: 0, optional: true, describe: "one story to read, by id or title; every story unless given" },
    from: { kind: "text", optional: true, describe: `the first committed day counted (UTC); ${OVER_TIME_DAYS} days before the last unless given` },
    to: { kind: "text", optional: true, describe: "the last committed day counted (UTC); today unless given" },
    json: { kind: "switch", describe: "the window and each story's measures and lane cost, as JSON" },
  },
  async act({ story, from, to, json }, context: VerbContext) {
    if (context.server === undefined) throw new VerbRefusal("Measure readings are kept beside the library, and this door has no library server open.");
    const [{ windowOf, storyLaneMeasures }, { measureReadingsPool }, { seriesIn, storiesOverTime, overTimeText }] = await Promise.all([import("@storytree/session-management/measures/verbs"), import("./readings.js"), import("./over-time.js")]);
    const window = windowOf(from, to, OVER_TIME_DAYS);
    const stories = (await storiesOf(context.library)).filter(({ id, title }) => story === undefined || story === id || story === title);
    if (stories.length === 0) throw new VerbRefusal(`No story in the plan is "${story}": name one by its id or title.`, { misuse: true });
    const db = await measureReadingsPool(context.server);
    const [records, series, lanes] = await Promise.all([context.library.measures(), seriesIn(db, { project: context.project, ...window }), storyLaneMeasures(context as Parameters<typeof storyLaneMeasures>[0], window)]);
    const report = storiesOverTime({ stories, records: records.map(({ id, fields }) => ({ id, fields: fields as Record<string, unknown> })), series, lanes });
    if (json) return { text: JSON.stringify({ window, stories: report }, null, 2), raw: true };
    return { text: overTimeText(window, report) };
  },
});

export const CODE_MEASURES_FAMILIES: readonly VerbFamily[] = [
  { name: "code-measures", summary: "each story's base code-structure measures at a commit (report only; Code measures')", order: 37.5, verbs: [PAIR as Verb<VerbInputs, VerbContext>, RECORD as Verb<VerbInputs, VerbContext>, STORY as Verb<VerbInputs, VerbContext>], bare: CODE_MEASURES as Verb<VerbInputs, VerbContext> },
];
