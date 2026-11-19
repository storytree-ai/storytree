// Capability 3 · Measure readings recorded on the box
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbContext, type VerbInputs } from "@storytree/library/verbs";
import { connect, type Library, type Storytree } from "@storytree/library";
import { removeTemp } from "@storytree/test-waits";

import * as codeMeasures from "./index.js";
import { CODE_MEASURES_FAMILIES } from "./verbs.js";

interface ReadingsDb {
  query(text: string, values?: unknown[]): Promise<{ rows: object[] }>;
}

interface ReadingsSeam {
  measureReadingsPool(server: Pick<Storytree, "ownDatabase">): Promise<ReadingsDb>;
  measureSeries(db: ReadingsDb, of: { project: string; story: string; measure: string; version: number }): Promise<{ story: string; measure: string; version: number; value: number; unit: string; commit: string; committed: string; machine: string; runs: number }[]>;
}

const seam = codeMeasures as unknown as ReadingsSeam;
const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

interface Repository {
  readonly folder: string;
  git(...args: string[]): string;
  commitAsOrigin(when: string): string;
  write(file: string, text: string): void;
}

function repository(t: TestContext): Repository {
  const folder = mkdtempSync(path.join(tmpdir(), "code-measures-record-"));
  t.after(() => removeTemp(folder));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  };
  const commitAsOrigin = (when: string) => {
    git("add", "-A");
    execFileSync("git", ["-c", "user.name=Measures test", "-c", "user.email=measures@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", `at ${when}`], {
      cwd: folder,
      env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
    });
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "https://example.test/fixture.git");
  write("package.json", '{ "name": "fixture", "private": true }\n');
  write(".gitignore", "packages/alpha-tools/src/*.mjs\n");
  write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
  write("packages/alpha-tools/src/a.ts", "export function a(x: number): number {\n  if (x > 0) return x;\n  return -x;\n}\n");
  write("packages/beta-kit/package.json", '{ "name": "@ws/beta-kit" }\n');
  write("packages/beta-kit/src/b.ts", "export const b = 1;\nexport const c = 2;\n");
  return { folder, git, commitAsOrigin, write };
}

function declareReaders(repo: Repository, story: string, file: string, readers: readonly { measure: string; read: string }[]): void {
  const manifest = { name: "@ws/alpha-tools", story, exports: { ".": "./src/a.ts", "./measures": `./src/${file}` }, storytree: { measures: [{ from: "./measures", export: "READERS" }] } };
  repo.write("packages/alpha-tools/package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const listed = readers.map(({ measure, read }) => `  { measure: ${JSON.stringify(measure)}, version: 1, read(story) { return ${read}; } },`);
  repo.write(`packages/alpha-tools/src/${file}`, `export const READERS = [\n${listed.join("\n")}\n];\n`);
}

function measure(title: string, story: string, machine: string, base: boolean): Record<string, unknown> {
  return { title, description: `${title}, for the record test`, story, ...(base ? { base: true } : {}), reads: title.toLowerCase(), unit: "lines", better: "lower", howRead: "from the story's measures", machine, runs: 1, version: 1 };
}

async function refusal(promise: Promise<unknown>): Promise<VerbRefusal> {
  const error = await promise.then(() => assert.fail("refused"), (thrown: unknown) => thrown);
  assert.ok(error instanceof VerbRefusal, `refused as the verb's own no: ${String(error)}`);
  return error;
}

test("3.2 · storytree code-measures record --machine mint records each story's value of every live base measure read on mint at origin/main, none where its reader gives none, and names with why a measure that does not pair while still recording every one that does; is refused, recording nothing, without --machine or without the server; and records nothing at a head already recorded or within a day of its last recording", async (t) => {
  const family = CODE_MEASURES_FAMILIES.find((one) => one.name === "code-measures");
  const record = family?.verbs.find((one) => mounted(one.command) && one.command.name === "record") as Verb<VerbInputs, VerbContext> | undefined;
  assert.ok(record !== undefined, "the code-measures family has a record verb");

  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
    }
  });
  const library: Library = await storytree.openProject(name);
  const alpha = await library.addStory({ title: "Alpha tools" });
  const beta = await library.addStory({ title: "Beta kit" });
  const lines = await library.writeKnowledge("measure", measure("Source lines", alpha.id, "mint", true) as never);
  const unread = await library.writeKnowledge("measure", measure("Never there", alpha.id, "mint", true) as never);
  const laptop = await library.writeKnowledge("measure", measure("Laptop lines", alpha.id, "laptop", true) as never);
  const own = await library.writeKnowledge("measure", measure("Own lines", alpha.id, "mint", false) as never);

  const repo = repository(t);
  const pairedReaders = [
    { measure: lines.id, read: "story.size?.sourceLines ?? null" },
    { measure: unread.id, read: "null" },
    { measure: laptop.id, read: "story.size?.sourceLines ?? null" },
    { measure: own.id, read: "story.size?.sourceLines ?? null" },
  ];
  declareReaders(repo, alpha.id, "unpaired.mjs", pairedReaders.filter(({ measure: id }) => id !== laptop.id));
  const first = repo.commitAsOrigin("2026-11-10T12:00:00Z");
  repo.write("packages/alpha-tools/src/a.ts", "export const dirty = 1;\n");

  const unserved: VerbContext = { folder: repo.folder, project: library.name, session: "s", library };
  const context: VerbContext = { ...unserved, server: storytree };
  const db = await seam.measureReadingsPool(storytree);
  const series = (story: string, id: string) => seam.measureSeries(db, { project: library.name, story, measure: id, version: 1 });
  const recorded = async () => (await Promise.all([alpha.id, beta.id].flatMap((story) => [lines.id, unread.id, laptop.id, own.id].map((id) => series(story, id))))).flat();

  const misuse = await refusal(record.act({ machine: undefined }, context, WORDS));
  assert.equal(misuse.misuse, true, "without --machine it is misuse");
  await refusal(record.act({ machine: "mint" }, unserved, WORDS));
  assert.deepEqual(await recorded(), [], "a refusal records nothing");
  const answer = await record.act({ machine: "mint" }, context, WORDS);
  const named = answer.text.split("\n").find((line) => line.includes("Laptop lines"));
  assert.ok(named !== undefined, `the answer names the measure that does not pair, whichever machine reads it: ${answer.text}`);
  assert.match(named, /no reader/, `with why it does not pair: ${answer.text}`);
  assert.match(answer.text, /\b2\b/, "two readings: Source lines for each story");
  assert.ok(answer.text.includes(first.slice(0, 7)), `it names the commit recorded: ${answer.text}`);
  const at = (value: number, story: string, commit: string, committed: string) => ({ story, measure: lines.id, version: 1, value, unit: "lines", commit, committed, machine: "mint", runs: 1 });
  const kept = (rows: readonly Record<string, unknown>[]) => rows.map(({ story, measure: id, version, value, unit, commit, committed, machine, runs }) => ({ story, measure: id, version, value, unit, commit, committed, machine, runs }));
  assert.deepEqual(kept(await series(alpha.id, lines.id)), [at(4, alpha.id, first, "2026-11-10T12:00:00.000Z")], "Alpha's source lines at origin/main, not the working tree's");
  assert.deepEqual(kept(await series(beta.id, lines.id)), [at(2, beta.id, first, "2026-11-10T12:00:00.000Z")], "a base measure is read for every story");
  assert.equal((await recorded()).length, 2, "no row for a reader giving none, a measure read on another machine or one that is not base");

  declareReaders(repo, alpha.id, "paired.mjs", pairedReaders);
  const same = await record.act({ machine: "mint" }, context, WORDS);
  assert.match(same.text, /already recorded/i);
  assert.doesNotMatch(same.text, /Laptop lines/, `a measure that pairs is not named: ${same.text}`);
  assert.equal((await recorded()).length, 2, "nothing recorded again at the same head");

  repo.write("packages/alpha-tools/src/a.ts", "export function a(x: number): number {\n  if (x > 0) return x;\n  if (x < -9) return 9;\n  return -x;\n}\n");
  const second = repo.commitAsOrigin("2026-11-12T12:00:00Z");
  const soon = await record.act({ machine: "mint" }, context, WORDS);
  assert.match(soon.text, /\bday\b/i, `a new head within a day of the last recording says why it records nothing: ${soon.text}`);
  assert.equal((await recorded()).length, 2, "nothing recorded within the day");

  await db.query("UPDATE measure_recordings SET recorded_at = recorded_at - interval '25 hours' WHERE project = $1 AND machine = 'mint'", [library.name]);
  await record.act({ machine: "mint" }, context, WORDS);
  assert.deepEqual(kept(await series(alpha.id, lines.id)), [at(4, alpha.id, first, "2026-11-10T12:00:00.000Z"), at(5, alpha.id, second, "2026-11-12T12:00:00.000Z")], "a day later, the new head is recorded beside the first");
});

function declareSamplers(repo: Repository, story: string, file: string, asked: string, readers: readonly { measure: string; member: string }[]): void {
  const manifest = { name: "@ws/alpha-tools", story, exports: { ".": "./src/a.ts", "./measures": `./src/${file}` }, storytree: { measures: [{ from: "./measures", export: "READERS" }] } };
  repo.write("packages/alpha-tools/package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const listed = readers.map(({ measure: id, member }) => `  { measure: ${JSON.stringify(id)}, version: 1, ${member} },`);
  repo.write(`packages/alpha-tools/src/${file}`, `const asked = (globalThis[${JSON.stringify(asked)}] ??= []);\nexport const READERS = [\n${listed.join("\n")}\n];\n`);
}

function sampler(id: string, answer: { value: number; runs: number; spread: number }): { measure: string; member: string } {
  return { measure: id, member: `async sample({ folder, commit, tree }) { asked.push({ measure: ${JSON.stringify(id)}, folder, commit, tree }); return ${JSON.stringify(answer)}; }` };
}

test("3.3 · recordMeasures reads each paired non-base measure of the given machine through its reader's sample at origin/main with the project's plan, one row on the record's story with the sample's value, runs and spread; gated once a head and once a day by its own readings apart from the base set's recording; reads none and names the load while the load is at or over the CPU count; names a dedicated measure whose reader has no sample and records it no row; names a dedicated measure whose reader is at another version and neither samples nor records it", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
    }
  });
  const library: Library = await storytree.openProject(name);
  const alpha = await library.addStory({ title: "Alpha tools" });
  const beta = await library.addStory({ title: "Beta kit" });
  const lines = await library.writeKnowledge("measure", measure("Source lines", alpha.id, "mint", true) as never);
  const wall = await library.writeKnowledge("measure", { ...measure("Survey wall", alpha.id, "mint", false), unit: "ms" } as never);
  const peak = await library.writeKnowledge("measure", { ...measure("Survey peak", alpha.id, "mint", false), unit: "MB" } as never);
  const laptop = await library.writeKnowledge("measure", { ...measure("Laptop wall", alpha.id, "laptop", false), unit: "ms" } as never);
  const untimed = await library.writeKnowledge("measure", measure("Survey untimed", alpha.id, "mint", false) as never);
  const stale = await library.writeKnowledge("measure", { ...measure("Survey stale", alpha.id, "mint", false), unit: "ms", version: 2 } as never);

  const repo = repository(t);
  const asked = `__dedicatedAsked_${randomBytes(4).toString("hex")}`;
  const dedicated = [wall.id, peak.id];
  declareSamplers(repo, alpha.id, `dedicated-${randomBytes(4).toString("hex")}.mjs`, asked, [
    { measure: lines.id, member: "read(story) { return story.size?.sourceLines ?? null; }" },
    sampler(wall.id, { value: 1234.5, runs: 5, spread: 0.25 }),
    sampler(peak.id, { value: 88.5, runs: 3, spread: 2 }),
    sampler(laptop.id, { value: 7, runs: 1, spread: 0 }),
    { measure: untimed.id, member: "read(story) { return 1; }" },
    sampler(stale.id, { value: 9, runs: 1, spread: 0 }),
  ]);
  const first = repo.commitAsOrigin("2026-11-10T12:00:00Z");

  const db = await codeMeasures.measureReadingsPool(storytree);
  const records = (await library.measures()).map(({ id, fields }) => ({ id, fields }));
  const readers = await codeMeasures.measureReadersOf(repo.folder);
  const stories = [{ id: alpha.id, title: "Alpha tools" }, { id: beta.id, title: "Beta kit" }];
  const plan = { arcs: [], stories: [{ id: alpha.id, title: "Alpha tools", capabilities: [] }], marker: name };
  let plans = 0;
  let load = { load: 6.5, cpus: 4 };
  const record = () => codeMeasures.recordMeasures({
    folder: repo.folder, project: library.name, machine: "mint", stories, records, readers, db,
    plan: async () => { plans += 1; return plan; },
    load: () => load,
  });
  const sampled = () => ((globalThis as Record<string, unknown>)[asked] as { measure: string; folder: string; commit: string; tree: unknown }[] | undefined) ?? [];
  const series = (story: string, id: string) => seam.measureSeries(db, { project: library.name, story, measure: id, version: 1 });
  const kept = (rows: readonly Record<string, unknown>[]) => rows.map(({ story, measure: id, version, value, unit, commit, machine, runs, spread }) => ({ story, measure: id, version, value, unit, commit, machine, runs, spread }));
  const wallAt = (commit: string) => ({ story: alpha.id, measure: wall.id, version: 1, value: 1234.5, unit: "ms", commit, machine: "mint", runs: 5, spread: 0.25 });
  const peakAt = (commit: string) => ({ story: alpha.id, measure: peak.id, version: 1, value: 88.5, unit: "MB", commit, machine: "mint", runs: 3, spread: 2 });
  const others = async () => (await Promise.all([
    series(beta.id, wall.id), series(beta.id, peak.id), series(alpha.id, laptop.id), series(beta.id, laptop.id), series(alpha.id, untimed.id), series(beta.id, untimed.id),
    ...[1, 2].map((version) => seam.measureSeries(db, { project: library.name, story: alpha.id, measure: stale.id, version })),
  ])).flat();

  const busy = await record();
  assert.match(busy, /busy/i, `a busy machine says so: ${busy}`);
  assert.ok(busy.includes("6.5"), `it names the load: ${busy}`);
  assert.equal((await series(alpha.id, lines.id)).length, 1, "the base set records while the machine is busy");
  assert.deepEqual([...kept(await series(alpha.id, wall.id)), ...kept(await series(alpha.id, peak.id))], [], "no dedicated measure is read while busy");
  assert.deepEqual(sampled(), []);
  assert.equal(plans, 0, "the plan is not fetched when no dedicated measure is read");

  load = { load: 4, cpus: 4 };
  assert.match(await record(), /busy/i, "a load equal to the CPU count is busy");
  assert.deepEqual(sampled(), []);

  load = { load: 0.5, cpus: 4 };
  const calm = await record();
  assert.match(calm, /already recorded/i, `the base line still says the head is recorded: ${calm}`);
  assert.ok(calm.includes("Survey untimed"), `a dedicated measure whose reader has no sample is named: ${calm}`);
  const staleLine = calm.split("\n").find((line) => line.includes("Survey stale"));
  assert.ok(staleLine !== undefined, `a dedicated measure whose reader is at another version is named: ${calm}`);
  assert.match(staleLine, /another version/, `with why it does not pair: ${calm}`);
  assert.deepEqual(kept(await series(alpha.id, wall.id)), [wallAt(first)]);
  assert.deepEqual(kept(await series(alpha.id, peak.id)), [peakAt(first)]);
  assert.deepEqual(await others(), [], "no row on another story, for another machine's measure, for a reader with no sample, or for a reader at another version");
  assert.deepEqual(sampled().map(({ measure: id, folder, commit, tree }) => ({ id, folder, commit, tree })).sort((a, b) => a.id.localeCompare(b.id)),
    dedicated.map((id) => ({ id, folder: repo.folder, commit: first, tree: plan })).sort((a, b) => a.id.localeCompare(b.id)),
    "each sample is asked once, at origin/main, with the project's plan");
  assert.equal((await series(alpha.id, lines.id)).length, 1, "the base set is not recorded again at its head");

  await record();
  assert.equal(sampled().length, 2, "no dedicated measure is read again at a head it recorded");
  assert.deepEqual(kept(await series(alpha.id, wall.id)), [wallAt(first)]);

  repo.write("packages/alpha-tools/src/a.ts", "export const second = 2;\n");
  const second = repo.commitAsOrigin("2026-11-12T12:00:00Z");
  await db.query("UPDATE measure_readings SET read_at = read_at - interval '25 hours' WHERE project = $1 AND measure = ANY($2)", [library.name, dedicated]);
  const baseDay = await record();
  assert.match(baseDay, /\bday\b/i, `the base set waits its day: ${baseDay}`);
  assert.equal((await series(alpha.id, lines.id)).length, 1, "the base set records nothing within its day");
  assert.deepEqual(kept(await series(alpha.id, wall.id)), [wallAt(first), wallAt(second)], "a day after their own last readings, the dedicated measures record the new head while the base set waits");
  assert.deepEqual(kept(await series(alpha.id, peak.id)), [peakAt(first), peakAt(second)]);

  repo.write("packages/alpha-tools/src/a.ts", "export const third = 3;\n");
  const third = repo.commitAsOrigin("2026-11-14T12:00:00Z");
  await db.query("UPDATE measure_recordings SET recorded_at = recorded_at - interval '25 hours' WHERE project = $1 AND machine = 'mint'", [library.name]);
  const dedicatedDay = await record();
  assert.match(dedicatedDay, /\bday\b/i, `the dedicated measures wait their day: ${dedicatedDay}`);
  assert.deepEqual((await series(alpha.id, lines.id)).map(({ commit }) => commit), [first, third], "a day after the base set's recording, it records the new head");
  assert.deepEqual(kept(await series(alpha.id, wall.id)), [wallAt(first), wallAt(second)], "the dedicated measures, read within their own day, are not");
  assert.deepEqual(kept(await series(alpha.id, peak.id)), [peakAt(first), peakAt(second)]);
  assert.equal(sampled().length, 4);
});

test("3.4 · recordMeasures hands each dedicated measure's sample the folder, origin/main's commit, the plan, the project and the library server; a sample answering undefined records no row and is named in the answer as having no reading, while the other dedicated measure is still recorded", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
    }
  });
  const library: Library = await storytree.openProject(name);
  const alpha = await library.addStory({ title: "Alpha tools" });
  const nothing = await library.writeKnowledge("measure", { ...measure("Run time unread", alpha.id, "mint", false), unit: "minutes" } as never);
  const wall = await library.writeKnowledge("measure", { ...measure("Run time read", alpha.id, "mint", false), unit: "minutes" } as never);

  const repo = repository(t);
  const asked = `__serverAsked_${randomBytes(4).toString("hex")}`;
  const handed = (id: string, answer: string) => ({
    measure: id,
    member: `async sample({ folder, commit, tree, project, server }) { asked.push({ measure: ${JSON.stringify(id)}, folder, commit, tree, project, server }); return ${answer}; }`,
  });
  declareSamplers(repo, alpha.id, `served-${randomBytes(4).toString("hex")}.mjs`, asked, [
    handed(nothing.id, "undefined"),
    handed(wall.id, JSON.stringify({ value: 17.5, runs: 6, spread: 4.25 })),
  ]);
  const head = repo.commitAsOrigin("2026-11-10T12:00:00Z");

  const db = await codeMeasures.measureReadingsPool(storytree);
  const byId = new Map((await library.measures()).map(({ id, fields }) => [id, { id, fields }]));
  const records = [byId.get(nothing.id)!, byId.get(wall.id)!];
  const readers = await codeMeasures.measureReadersOf(repo.folder);
  const plan = { arcs: [], stories: [{ id: alpha.id, title: "Alpha tools", capabilities: [] }], marker: name };
  const recordWithServer = codeMeasures.recordMeasures as (input: Parameters<typeof codeMeasures.recordMeasures>[0] & { readonly server: Storytree }) => Promise<string>;
  const answer = await recordWithServer({
    folder: repo.folder, project: library.name, machine: "mint", stories: [{ id: alpha.id, title: "Alpha tools" }], records, readers, db,
    plan: async () => plan,
    load: () => ({ load: 0.5, cpus: 4 }),
    server: storytree,
  });

  const sampled = ((globalThis as Record<string, unknown>)[asked] as { measure: string; folder: string; commit: string; tree: unknown; project: string; server: unknown }[] | undefined) ?? [];
  assert.deepEqual(
    sampled.map(({ measure: id, folder, commit, tree, project, server }) => ({ id, folder, commit, tree, project, server: server === storytree })).sort((a, b) => a.id.localeCompare(b.id)),
    [nothing.id, wall.id].map((id) => ({ id, folder: repo.folder, commit: head, tree: plan, project: library.name, server: true })).sort((a, b) => a.id.localeCompare(b.id)),
    "each sample is asked once with the folder, the head, the plan, the project and the very server recordMeasures was given",
  );

  const series = (id: string) => seam.measureSeries(db, { project: library.name, story: alpha.id, measure: id, version: 1 });
  const kept = (rows: readonly Record<string, unknown>[]) => rows.map(({ story, measure: id, version, value, unit, commit, machine, runs, spread }) => ({ story, measure: id, version, value, unit, commit, machine, runs, spread }));
  assert.deepEqual(kept(await series(wall.id)), [{ story: alpha.id, measure: wall.id, version: 1, value: 17.5, unit: "minutes", commit: head, machine: "mint", runs: 6, spread: 4.25 }], "the measure whose sample answered is recorded, though the one before it answered none");
  assert.deepEqual(await series(nothing.id), [], "a sample answering undefined records no row");

  assert.match(answer, /\b1 reading of 2 dedicated measures\b/, `one reading recorded of the two dedicated measures: ${answer}`);
  const unread = answer.split("\n").find((line) => line.includes("Run time unread"));
  assert.ok(unread !== undefined, `the measure with no reading is named: ${answer}`);
  assert.match(unread, /no reading/i, `it is named as having no reading: ${answer}`);
});

interface StoryMutation {
  readonly planted: number;
  readonly caught: number;
  readonly judged: number;
  readonly ms: number;
}

interface MutationPart {
  readonly name: string;
  storyMutation?(root: string, packages: readonly string[], options: { cap: number; budgetMs: number }): Promise<StoryMutation>;
}

interface SampledSeam {
  recordSampled?(input: {
    folder: string;
    project: string;
    machine: string;
    stories: readonly { id: string; title: string }[];
    records: readonly { id: string; fields: Readonly<Record<string, unknown>> }[];
    readers: Awaited<ReturnType<typeof codeMeasures.measureReadersOf>>;
    db: ReadingsDb;
    parts: readonly MutationPart[];
    load?: () => { load: number; cpus: number };
  }): Promise<string>;
}

function mutationSampler(id: string): { measure: string; member: string } {
  return {
    measure: id,
    member: [
      "async sample({ folder, commit, story, parts }) {",
      `    asked.push({ measure: ${JSON.stringify(id)}, folder, commit, story, parts: parts.map((part) => part.name) });`,
      '    const part = parts.find((one) => typeof one.storyMutation === "function");',
      '    const found = await part.storyMutation(folder, story.packages.map((dir) => "packages/" + dir), { cap: 100, budgetMs: 60000 });',
      "    return found.judged === 0 ? undefined : { value: found.caught / found.judged, runs: found.judged, spread: null };",
      "  }",
    ].join("\n"),
  };
}

const STAND_IN: MutationPart = {
  name: "stand-in",
  async storyMutation(_root, packages) {
    return packages.includes("packages/alpha-tools") ? { planted: 100, caught: 30, judged: 40, ms: 61_000 } : { planted: 3, caught: 0, judged: 0, ms: 900_000 };
  },
};

async function project(t: TestContext): Promise<{ storytree: Storytree; library: Library }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
    }
  });
  return { storytree, library: await storytree.openProject(name) };
}

test("3.5 · recordMeasures's daily run leaves out a base measure whose reader only samples, asking it nothing, and still records every base measure read plainly", async (t) => {
  const { storytree, library } = await project(t);
  const alpha = await library.addStory({ title: "Alpha tools" });
  const beta = await library.addStory({ title: "Beta kit" });
  const lines = await library.writeKnowledge("measure", measure("Source lines", alpha.id, "mint", true) as never);
  const score = await library.writeKnowledge("measure", { ...measure("Mutation score", alpha.id, "mint", true), unit: "share", better: "higher" } as never);

  const repo = repository(t);
  const asked = `__dailyAsked_${randomBytes(4).toString("hex")}`;
  declareSamplers(repo, alpha.id, `daily-${randomBytes(4).toString("hex")}.mjs`, asked, [
    { measure: lines.id, member: "read(story) { return story.size?.sourceLines ?? null; }" },
    mutationSampler(score.id),
  ]);
  const head = repo.commitAsOrigin("2026-11-10T12:00:00Z");

  const db = await codeMeasures.measureReadingsPool(storytree);
  const records = (await library.measures()).map(({ id, fields }) => ({ id, fields }));
  const readers = await codeMeasures.measureReadersOf(repo.folder);
  const answer = await codeMeasures.recordMeasures({
    folder: repo.folder, project: library.name, machine: "mint", stories: [{ id: alpha.id, title: "Alpha tools" }, { id: beta.id, title: "Beta kit" }], records, readers, db,
    plan: async () => ({ arcs: [], stories: [] }),
    load: () => ({ load: 0.5, cpus: 4 }),
  });

  const series = (story: string, id: string) => seam.measureSeries(db, { project: library.name, story, measure: id, version: 1 });
  assert.deepEqual((await series(alpha.id, lines.id)).map(({ value, commit }) => [value, commit]), [[4, head]], `the plainly read base measure is recorded: ${answer}`);
  assert.deepEqual((await series(beta.id, lines.id)).map(({ value, commit }) => [value, commit]), [[2, head]]);
  assert.deepEqual([...(await series(alpha.id, score.id)), ...(await series(beta.id, score.id))], [], "no row for the sampled base measure");
  assert.equal((globalThis as Record<string, unknown>)[asked], undefined, "its sample is not asked by the daily run");
});

test("3.5 · recordSampled records, through the readings writer, each story's value of every base measure on the machine read only by a sample, at origin/main when HEAD is origin/main: once a head and once a week by its own readings, nothing while the load is at or over the CPU count, naming it when no part offers storyMutation; the mutation verb answers with it and is refused without --machine or the server", async (t) => {
  const { storytree, library } = await project(t);
  const alpha = await library.addStory({ title: "Alpha tools" });
  const beta = await library.addStory({ title: "Beta kit" });
  const lines = await library.writeKnowledge("measure", measure("Source lines", alpha.id, "mint", true) as never);
  const score = await library.writeKnowledge("measure", { ...measure("Mutation score", alpha.id, "mint", true), unit: "share", better: "higher" } as never);
  const laptop = await library.writeKnowledge("measure", { ...measure("Laptop score", alpha.id, "laptop", true), unit: "share", better: "higher" } as never);
  const dedicated = await library.writeKnowledge("measure", { ...measure("Own score", alpha.id, "mint", false), unit: "share", better: "higher" } as never);

  const repo = repository(t);
  const asked = `__sampledAsked_${randomBytes(4).toString("hex")}`;
  declareSamplers(repo, alpha.id, `sampled-${randomBytes(4).toString("hex")}.mjs`, asked, [
    { measure: lines.id, member: "read(story) { return story.size?.sourceLines ?? null; }" },
    mutationSampler(score.id),
    mutationSampler(laptop.id),
    mutationSampler(dedicated.id),
  ]);
  const first = repo.commitAsOrigin("2026-11-10T12:00:00Z");

  const recordSampled = (codeMeasures as unknown as SampledSeam).recordSampled;
  assert.equal(typeof recordSampled, "function", "code measures exports recordSampled");
  const db = await codeMeasures.measureReadingsPool(storytree);
  const records = (await library.measures()).map(({ id, fields }) => ({ id, fields }));
  const readers = await codeMeasures.measureReadersOf(repo.folder);
  const stories = [{ id: alpha.id, title: "Alpha tools" }, { id: beta.id, title: "Beta kit" }, { id: "story_c3c3c3c3c3c3", title: "Gamma bare" }];
  let load = { load: 0.5, cpus: 4 };
  const sample = (parts: readonly MutationPart[]) => recordSampled!({ folder: repo.folder, project: library.name, machine: "mint", stories, records, readers, db, parts, load: () => load });
  const sampled = () => ((globalThis as Record<string, unknown>)[asked] as { measure: string; folder: string; commit: string; story: { id: string; title: string; packages: readonly string[] }; parts: string[] }[] | undefined) ?? [];
  const series = (story: string, id: string) => seam.measureSeries(db, { project: library.name, story, measure: id, version: 1 });
  const kept = (rows: readonly Record<string, unknown>[]) => rows.map(({ story, measure: id, version, value, unit, commit, committed, machine, runs, spread }) => ({ story, measure: id, version, value, unit, commit, committed, machine, runs, spread }));
  const scoreAt = (commit: string, committed: string) => ({ story: alpha.id, measure: score.id, version: 1, value: 0.75, unit: "share", commit, committed, machine: "mint", runs: 40, spread: null });
  const all = async () => (await Promise.all([alpha.id, beta.id].flatMap((story) => [lines.id, score.id, laptop.id, dedicated.id].map((id) => series(story, id))))).flat();

  const partless = await sample([{ name: "plain" }]);
  assert.match(partless, /storyMutation/, `no part offering storyMutation is named: ${partless}`);
  assert.deepEqual(await all(), [], "nothing recorded without a part");
  assert.deepEqual(sampled(), [], "no sample asked without a part");

  load = { load: 6.5, cpus: 4 };
  const busy = await sample([STAND_IN]);
  assert.match(busy, /busy/i, `a busy machine says so: ${busy}`);
  assert.ok(busy.includes("6.5"), `it names the load: ${busy}`);
  load = { load: 4, cpus: 4 };
  assert.match(await sample([STAND_IN]), /busy/i, "a load equal to the CPU count is busy");
  assert.deepEqual(await all(), [], "nothing recorded while busy");
  assert.deepEqual(sampled(), []);
  load = { load: 0.5, cpus: 4 };

  repo.write("packages/alpha-tools/src/a.ts", "export const ahead = 1;\n");
  repo.git("add", "-A");
  repo.git("-c", "user.name=Measures test", "-c", "user.email=measures@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "ahead of origin/main");
  const ahead = await sample([STAND_IN]);
  assert.match(ahead, /origin\/main/, `a HEAD that is not origin/main records nothing, saying so: ${ahead}`);
  assert.deepEqual(await all(), []);
  assert.deepEqual(sampled(), []);
  repo.git("reset", "-q", "--hard", first);

  const recorded = await sample([STAND_IN]);
  assert.match(recorded, /\b1 reading\b/, `it says how many readings it recorded: ${recorded}`);
  assert.deepEqual(kept(await series(alpha.id, score.id)), [scoreAt(first, "2026-11-10T12:00:00.000Z")], "Alpha's score: caught over judged, the breaks judged as runs, no spread, at origin/main");
  assert.equal((await all()).length, 1, "no row for Beta, whose sample answered none, for another machine's measure, for a dedicated measure, or for a base measure read plainly");
  assert.deepEqual(
    sampled().map(({ measure: id, folder, commit, story, parts }) => ({ id, folder, commit, story, parts })),
    [
      { id: score.id, folder: repo.folder, commit: first, story: { id: alpha.id, title: "Alpha tools", packages: ["alpha-tools"] }, parts: ["stand-in"] },
      { id: score.id, folder: repo.folder, commit: first, story: { id: beta.id, title: "Beta kit", packages: ["beta-kit"] }, parts: ["stand-in"] },
    ],
    "the sample is asked once for each story whose packages are in the checkout, with the parts given, in the stories' order",
  );

  await db.query("UPDATE measure_readings SET read_at = read_at - interval '8 days' WHERE project = $1", [library.name]);
  const same = await sample([STAND_IN]);
  assert.match(same, /already/i, `a head already read records nothing, however long ago: ${same}`);
  assert.equal(sampled().length, 2, "no sample asked again at the same head");
  await db.query("UPDATE measure_readings SET read_at = read_at + interval '8 days' WHERE project = $1", [library.name]);

  repo.write("packages/alpha-tools/src/a.ts", "export const second = 2;\n");
  const second = repo.commitAsOrigin("2026-11-12T12:00:00Z");
  const soon = await sample([STAND_IN]);
  assert.match(soon, /\bweek\b|\b7 days\b/i, `a new head within a week of the last reading says why it records nothing: ${soon}`);
  await db.query("UPDATE measure_readings SET read_at = read_at - interval '6 days' WHERE project = $1", [library.name]);
  assert.match(await sample([STAND_IN]), /\bweek\b|\b7 days\b/i, "six days later is still within the week");
  assert.equal(sampled().length, 2, "nothing sampled within the week");
  await db.query("UPDATE measure_readings SET read_at = read_at - interval '25 hours' WHERE project = $1", [library.name]);
  await sample([STAND_IN]);
  assert.deepEqual(kept(await series(alpha.id, score.id)), [scoreAt(first, "2026-11-10T12:00:00.000Z"), scoreAt(second, "2026-11-12T12:00:00.000Z")], "a week after its last reading, the new head is recorded beside the first");

  const family = CODE_MEASURES_FAMILIES.find((one) => one.name === "code-measures");
  const mutation = family?.verbs.find((one) => mounted(one.command) && one.command.name === "mutation") as Verb<VerbInputs, VerbContext> | undefined;
  assert.ok(mutation !== undefined, "the code-measures family has a mutation verb");
  const unserved = { folder: repo.folder, project: library.name, session: "s", library, projectRecords: async () => [STAND_IN] } as VerbContext;
  const context = { ...unserved, server: storytree } as VerbContext;
  const before = await all();
  const misuse = await refusal(mutation.act({ machine: undefined }, context, WORDS));
  assert.equal(misuse.misuse, true, "without --machine it is misuse");
  await refusal(mutation.act({ machine: "mint" }, unserved, WORDS));
  const again = await mutation.act({ machine: "mint" }, context, WORDS);
  assert.match(again.text, /already/i, `the verb answers with recordSampled's text, here the head already read: ${again.text}`);
  assert.deepEqual(await all(), before, "the verb's refusals and its answer at a head already read record nothing");
});
