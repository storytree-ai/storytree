// Capability 4 · Measures over time per story
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

import { connect, type Library, type Storytree } from "@storytree/library";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbContext, type VerbInputs } from "@storytree/library/verbs";
import { forgetProjectActivity, openActivityLog, type ActivityLog } from "@storytree/session-management";
import { MEASURES_FAMILIES } from "@storytree/session-management/measures/verbs";
import { removeTemp } from "@storytree/test-waits";

import * as codeMeasures from "./index.js";
import { CODE_MEASURES_FAMILIES } from "./verbs.js";

interface ReadingsDb {
  query(text: string, values?: unknown[]): Promise<{ rows: object[] }>;
}

interface ReadingRow {
  readonly project: string;
  readonly story: string;
  readonly measure: string;
  readonly version: number;
  readonly value: number;
  readonly unit: string;
  readonly commit: string;
  readonly committed: string;
  readonly machine: string;
  readonly runs: number;
  readonly spread: number | null;
  readonly readAt: string;
}

interface ReadingsSeam {
  measureReadingsPool(server: Pick<Storytree, "ownDatabase">): Promise<ReadingsDb>;
  writeReadings(db: ReadingsDb, rows: readonly ReadingRow[]): Promise<void>;
}

interface StoryMeasure {
  readonly measure: string;
  readonly title: string;
  readonly base?: boolean;
  readonly version: number;
  readonly machine: string;
  readonly unit: string;
  readonly readings: readonly { commit: string; committed: string; value: number; runs: number; spread: number | null }[];
  readonly latest?: number;
  readonly limits?: { centre: number; lower: number; upper: number };
  readonly reads?: string;
}

interface StoryReport {
  readonly window: { from: string; to: string };
  readonly stories: readonly { id: string; title: string; measures: readonly StoryMeasure[]; lane?: Record<string, unknown> & { id: string; lanes: number; landed: number; tokens: { median?: number; range?: readonly number[] } } }[];
}

const seam = codeMeasures as unknown as ReadingsSeam;
const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

interface World {
  readonly storytree: Storytree;
  readonly library: Library;
  readonly log: ActivityLog;
  readonly db: ReadingsDb;
  readonly context: VerbContext & { readonly log: ActivityLog };
  readonly alpha: string;
  readonly beta: string;
  readonly gamma: string;
}

async function world(t: TestContext): Promise<World> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(name);
  const log = await openActivityLog(storytree);
  const db = await seam.measureReadingsPool(storytree);
  const folder = mkdtempSync(path.join(tmpdir(), "code-measures-story-"));
  t.after(async () => {
    try {
      await log.close();
      await db.query("DELETE FROM measure_readings WHERE project = $1", [name]);
      await forgetProjectActivity(storytree, name);
      await storytree.dropProject(name);
      await removeTemp(folder);
    } finally {
      await storytree.close();
    }
  });
  const alpha = (await library.addStory({ title: "Alpha tools" })).id;
  const beta = (await library.addStory({ title: "Beta kit" })).id;
  const gamma = (await library.addStory({ title: "Gamma bare" })).id;
  return { storytree, library, log, db, context: { folder, project: name, session: "s", library, server: storytree, log }, alpha, beta, gamma };
}

function storyVerb(): Verb<VerbInputs, VerbContext> {
  const family = CODE_MEASURES_FAMILIES.find((one) => one.name === "code-measures");
  const verb = family?.verbs.find((one) => mounted(one.command) && one.command.name === "story") as Verb<VerbInputs, VerbContext> | undefined;
  assert.ok(verb !== undefined, "the code-measures family has a story verb");
  return verb;
}

function measure(title: string, story: string, base: boolean, unit: string, runs: number): Record<string, unknown> {
  return { title, description: `${title}, for the story test`, story, ...(base ? { base: true } : {}), reads: title.toLowerCase(), unit, better: "lower", howRead: "from the story's measures", machine: "mint", runs, version: 1 };
}

function section(text: string, title: string, titles: readonly string[]): string {
  const start = text.indexOf(title);
  assert.ok(start >= 0, `the text names ${title}`);
  const ends = titles.filter((other) => other !== title).map((other) => text.indexOf(other, start + 1)).filter((at) => at > start);
  return text.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
}

const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}T12:00:00.000Z`;
const WINDOW = { from: "2026-11-01", to: "2026-11-14" };

test("4.3 · storytree code-measures story prints every story in the plan, or the one named by id or title, with each base measure and each of its own dedicated measures: latest, the series in the window, limits and reading, or no readings; refused without the server, report only", async (t) => {
  const story = storyVerb();
  const { library, db, context, alpha, beta, gamma } = await world(t);
  const lines = (await library.writeKnowledge("measure", measure("Source lines", alpha, true, "lines", 1) as never)).id;
  const timing = (await library.writeKnowledge("measure", measure("Alpha timing", alpha, false, "ms", 5) as never)).id;
  const betaOwn = (await library.writeKnowledge("measure", measure("Beta reach", beta, false, "files", 1) as never)).id;
  const row = (story: string, id: string, unit: string, n: number, value: number, more: Partial<ReadingRow> = {}): ReadingRow => ({
    project: context.project, story, measure: id, version: 1, value, unit, commit: `c${n}`.padEnd(40, "0"), committed: day(n), machine: "mint", runs: 1, spread: null, readAt: "2026-11-18T06:00:00.000Z", ...more,
  });
  const alphaLines = [12_040, 12_110, 12_075, 12_180, 12_150, 12_400];
  const betaLines = [600, 640, 610, 650, 620, 630];
  await seam.writeReadings(db, [
    row(alpha, lines, "lines", 0, 20_000, { committed: "2026-10-20T12:00:00.000Z" }),
    ...alphaLines.map((value, index) => row(alpha, lines, "lines", index + 2, value)),
    ...betaLines.map((value, index) => row(beta, lines, "lines", index + 2, value)),
    ...[810, 795.5, 802.25].map((value, index) => row(alpha, timing, "ms", index + 2, value, { runs: 5, spread: [0.25, 0.3, 0.2][index]! })),
  ]);

  const { server: _server, ...unserved } = context;
  await assert.rejects(story.act({ json: true, ...WINDOW }, unserved, WORDS), (error: unknown) => error instanceof VerbRefusal, "refused as the verb's own no without the server");

  const report = JSON.parse((await story.act({ json: true, ...WINDOW }, context, WORDS)).text) as StoryReport;
  assert.deepEqual(report.window, WINDOW);
  assert.deepEqual(report.stories.map(({ id }) => id).sort(), [alpha, beta, gamma].sort(), "every story in the plan, the one with no readings too");
  const of = (id: string) => report.stories.find((one) => one.id === id)!;
  const measures = (id: string) => new Map(of(id).measures.map((one) => [one.measure, one]));
  assert.equal(of(alpha).title, "Alpha tools");
  assert.deepEqual([...measures(alpha).keys()].sort(), [lines, timing].sort(), "Alpha: the base measure and its own");
  assert.deepEqual([...measures(beta).keys()].sort(), [lines, betaOwn].sort(), "Beta: the base measure and its own, not Alpha's");
  assert.deepEqual([...measures(gamma).keys()], [lines], "Gamma: the base measure alone");

  const alphaLine = measures(alpha).get(lines)!;
  assert.equal(alphaLine.title, "Source lines");
  assert.equal(alphaLine.base, true);
  assert.deepEqual([alphaLine.version, alphaLine.machine, alphaLine.unit], [1, "mint", "lines"]);
  assert.deepEqual(alphaLine.readings.map(({ value }) => value), alphaLines, "the window's readings, oldest first, none from before it");
  assert.equal(alphaLine.latest, 12_400);
  assert.ok(alphaLine.limits !== undefined && Math.abs(alphaLine.limits.upper - 12_270.6) < 1e-9 && Math.abs(alphaLine.limits.lower - 11_951.4) < 1e-9, `limits from the window's earlier readings: ${JSON.stringify(alphaLine.limits)}`);
  assert.equal(alphaLine.reads, "shifted up");

  const alphaTiming = measures(alpha).get(timing)!;
  assert.notEqual(alphaTiming.base, true);
  assert.equal(alphaTiming.reads, "too few readings");
  assert.equal(alphaTiming.limits, undefined);
  assert.equal(alphaTiming.latest, 802.25);
  assert.deepEqual(alphaTiming.readings.map(({ runs, spread }) => [runs, spread]), [[5, 0.25], [5, 0.3], [5, 0.2]], "a repeated measure's runs and spread");

  assert.equal(measures(beta).get(lines)!.reads, "not shown");
  for (const none of [measures(beta).get(betaOwn)!, measures(gamma).get(lines)!]) {
    assert.deepEqual(none.readings, []);
    assert.equal(none.latest, undefined);
    assert.equal(none.limits, undefined);
  }

  const text = (await story.act({ json: false, ...WINDOW }, context, WORDS)).text;
  const titles = ["Alpha tools", "Beta kit", "Gamma bare"];
  const alphaText = section(text, "Alpha tools", titles);
  assert.match(alphaText, /Source lines \(base\)[^\n]*shifted up/, "a base measure's line says it is base");
  assert.match(alphaText, /Alpha timing[^\n]*too few readings/);
  assert.doesNotMatch(alphaText, /Alpha timing[^\n]*\(base\)/, "a dedicated measure's line does not say base");
  const betaText = section(text, "Beta kit", titles);
  assert.match(betaText, /Source lines[^\n]*not shown/);
  assert.match(betaText, /Beta reach[^\n]*no readings/);
  assert.match(section(text, "Gamma bare", titles), /Source lines[^\n]*no readings/);

  for (const named of ["Beta kit", beta]) {
    const one = JSON.parse((await story.act({ json: true, story: named, ...WINDOW }, context, WORDS)).text) as StoryReport;
    assert.deepEqual(one.stories.map(({ id }) => id), [beta], `the story named ${named} alone`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const month = JSON.parse((await story.act({ json: true }, context, WORDS)).text) as StoryReport;
  assert.deepEqual(month.window, { from: new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10), to: today }, "the 30 days ending today unless given");
});

function claudeLine(requestId: string, input: number, output: number): string {
  return JSON.stringify({ type: "assistant", requestId, isSidechain: false, message: { model: "claude-opus-5-5", role: "assistant", usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: output } } });
}

test("4.4 · storytree code-measures story prints each story's lane cost as the lane measures join reads it over the same window, storing nothing", async (t) => {
  const story = storyVerb();
  const { library, log, db, context, alpha, beta, gamma } = await world(t);
  const alphaCap = (await library.addCapability({ title: "Alpha cap", story: alpha })).id;
  const betaCap = (await library.addCapability({ title: "Beta cap", story: beta })).id;
  const arc = await library.createArc({ title: "Lanes", intent: "Drive lanes", endState: "Lanes closed" });
  const lane = async (title: string, capability: string, session: string, input: number, output: number, closing: Parameters<Library["closeIncrement"]>[1]) => {
    const id = (await library.addIncrement({ arc: arc.id, title, objective: title, body: title, capabilities: [capability] })).id;
    await library.closeIncrement(id, closing);
    await log.append(context.project, { source: "hook", folder: "/work", harness: "claude-code", session, kind: "claimed", increment: id, reason: title });
    await log.transcripts.store(context.project, session, [{ part: "", start: 0, finish: 999, record: claudeLine(`req_${session}`, input, output) }]);
  };
  await lane("Alpha landed", alphaCap, "L", 100, 40, { pr: "#5", disposition: "landed", date: "2026-11-05" });
  await lane("Alpha failed", alphaCap, "K", 1_000, 60, { disposition: "failed", note: "no", date: "2026-11-06" });
  await lane("Alpha old", alphaCap, "O", 999_000, 1_000, { pr: "#2", disposition: "landed", date: "2026-10-01" });
  await lane("Beta landed", betaCap, "B", 5, 5, { pr: "#9", disposition: "landed", date: "2026-11-08" });
  const stored = async () => (await db.query("SELECT * FROM measure_readings WHERE project = $1", [context.project])).rows;

  const measuresVerb = MEASURES_FAMILIES[0]!.bare!;
  for (const window of [WINDOW, { from: "2026-09-25", to: "2026-10-02" }]) {
    const join = JSON.parse((await measuresVerb.act({ json: true, ...window }, context as never, WORDS)).text) as { stories: { id: string }[] };
    const report = JSON.parse((await story.act({ json: true, ...window }, context, WORDS)).text) as StoryReport;
    for (const id of [alpha, beta, gamma]) {
      assert.deepEqual(report.stories.find((one) => one.id === id)?.lane, join.stories.find((one) => one.id === id), `${id}'s lane cost over ${window.from}–${window.to} is the join's`);
    }
  }

  const report = JSON.parse((await story.act({ json: true, ...WINDOW }, context, WORDS)).text) as StoryReport;
  const alphaLane = report.stories.find((one) => one.id === alpha)!.lane!;
  assert.deepEqual([alphaLane.lanes, alphaLane.landed, alphaLane.tokens.median, alphaLane.tokens.range], [2, 1, 600, [140, 1_060]], "Alpha's two lanes in the window, the old one left out");
  assert.equal(report.stories.find((one) => one.id === gamma)!.lane, undefined, "a story no lane touched has no lane cost");
  assert.match(section((await story.act({ json: false, ...WINDOW }, context, WORDS)).text, "Alpha tools", ["Alpha tools", "Beta kit", "Gamma bare"]), /\b2 lanes\b/);
  assert.deepEqual(await stored(), [], "the lane cost is read, never stored");
});
