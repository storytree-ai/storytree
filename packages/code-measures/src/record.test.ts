/**
 * Code measures, capability 3 · Measure readings recorded on the box: contract 3.2 (`storytree code-measures record
 * --machine <name>` records, at origin/main as last fetched, every story's value of each live base measure whose machine
 * is the one named, refused when any measure does not pair or without --machine, at most once a day on a new head).
 *
 * The fixture is a git checkout whose one reading package, Alpha tools', declares readers for measure records written into
 * a test project's library on the test Postgres `pnpm test` starts, and whose origin/main is set by hand: nothing is fetched. Its stories are Alpha tools and Beta kit.
 */
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

/** The seam the builder provides from the package's index (contract 3.1), read here to see what was recorded. */
interface ReadingsSeam {
  measureReadingsPool(server: Pick<Storytree, "ownDatabase">): Promise<ReadingsDb>;
  measureSeries(db: ReadingsDb, of: { project: string; story: string; measure: string; version: number }): Promise<{ story: string; measure: string; version: number; value: number; unit: string; commit: string; committed: string; machine: string; runs: number }[]>;
}

const seam = codeMeasures as unknown as ReadingsSeam;
const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

interface Repository {
  readonly folder: string;
  git(...args: string[]): string;
  /** Commit everything at `when`, and set origin/main to it as if fetched. */
  commitAsOrigin(when: string): string;
  write(file: string, text: string): void;
}

/** A checkout with an origin whose main is set by hand: packages/alpha-tools (4 source lines) and packages/beta-kit (2). */
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
  // The readers' modules are read from the working tree, never committed: committed, they would be Alpha's source too.
  write(".gitignore", "packages/alpha-tools/src/*.mjs\n");
  write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
  write("packages/alpha-tools/src/a.ts", "export function a(x: number): number {\n  if (x > 0) return x;\n  return -x;\n}\n");
  write("packages/beta-kit/package.json", '{ "name": "@ws/beta-kit" }\n');
  write("packages/beta-kit/src/b.ts", "export const b = 1;\nexport const c = 2;\n");
  return { folder, git, commitAsOrigin, write };
}

/**
 * Alpha tools' manifest, naming its story and declaring `readers` (each a measure id and the body of its read) in
 * src/<file>: a file of its own each time, since a module once imported is not read again.
 */
function declareReaders(repo: Repository, story: string, file: string, readers: readonly { measure: string; read: string }[]): void {
  const manifest = { name: "@ws/alpha-tools", story, exports: { ".": "./src/a.ts", "./measures": `./src/${file}` }, storytree: { measures: [{ from: "./measures", export: "READERS" }] } };
  repo.write("packages/alpha-tools/package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const listed = readers.map(({ measure, read }) => `  { measure: ${JSON.stringify(measure)}, version: 1, read(story) { return ${read}; } },`);
  repo.write(`packages/alpha-tools/src/${file}`, `export const READERS = [\n${listed.join("\n")}\n];\n`);
}

/** A measure record's fields (6.24), version 1. */
function measure(title: string, story: string, machine: string, base: boolean): Record<string, unknown> {
  return { title, description: `${title}, for the record test`, story, ...(base ? { base: true } : {}), reads: title.toLowerCase(), unit: "lines", better: "lower", howRead: "from the story's measures", machine, runs: 1, version: 1 };
}

async function refusal(promise: Promise<unknown>): Promise<VerbRefusal> {
  const error = await promise.then(() => assert.fail("refused"), (thrown: unknown) => thrown);
  assert.ok(error instanceof VerbRefusal, `refused as the verb's own no: ${String(error)}`);
  return error;
}

test("3.2 · storytree code-measures record --machine mint records each story's value of every live base measure read on mint at origin/main, none where its reader gives none; is refused, recording nothing, without --machine, without the server or when a measure does not pair; and records nothing at a head already recorded or within a day of its last recording", async (t) => {
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
  const unread = await library.writeKnowledge("measure", measure("Never there", alpha.id, "mint", true) as never); // its reader gives none
  const laptop = await library.writeKnowledge("measure", measure("Laptop lines", alpha.id, "laptop", true) as never); // read on another machine
  const own = await library.writeKnowledge("measure", measure("Own lines", alpha.id, "mint", false) as never); // not a base measure

  const repo = repository(t);
  const pairedReaders = [
    { measure: lines.id, read: "story.size?.sourceLines ?? null" },
    { measure: unread.id, read: "null" },
    { measure: laptop.id, read: "story.size?.sourceLines ?? null" },
    { measure: own.id, read: "story.size?.sourceLines ?? null" },
  ];
  declareReaders(repo, alpha.id, "unpaired.mjs", pairedReaders.filter(({ measure: id }) => id !== laptop.id)); // Laptop lines has no reader yet
  const first = repo.commitAsOrigin("2026-11-10T12:00:00Z");
  repo.write("packages/alpha-tools/src/a.ts", "export const dirty = 1;\n"); // the working tree is not what is read

  const unserved: VerbContext = { folder: repo.folder, project: library.name, session: "s", library };
  const context: VerbContext = { ...unserved, server: storytree };
  const db = await seam.measureReadingsPool(storytree);
  const series = (story: string, id: string) => seam.measureSeries(db, { project: library.name, story, measure: id, version: 1 });
  const recorded = async () => (await Promise.all([alpha.id, beta.id].flatMap((story) => [lines.id, unread.id, laptop.id, own.id].map((id) => series(story, id))))).flat();

  const misuse = await refusal(record.act({ machine: undefined }, context, WORDS));
  assert.equal(misuse.misuse, true, "without --machine it is misuse");
  await refusal(record.act({ machine: "mint" }, unserved, WORDS));
  const unpaired = await refusal(record.act({ machine: "mint" }, context, WORDS));
  assert.match(unpaired.message, /Laptop lines/, "the refusal names the measure that does not pair, whichever machine reads it");
  assert.deepEqual(await recorded(), [], "a refusal records nothing");

  declareReaders(repo, alpha.id, "paired.mjs", pairedReaders);
  const answer = await record.act({ machine: "mint" }, context, WORDS);
  assert.match(answer.text, /\b2\b/, "two readings: Source lines for each story");
  assert.ok(answer.text.includes(first.slice(0, 7)), `it names the commit recorded: ${answer.text}`);
  const at = (value: number, story: string, commit: string, committed: string) => ({ story, measure: lines.id, version: 1, value, unit: "lines", commit, committed, machine: "mint", runs: 1 });
  const kept = (rows: readonly Record<string, unknown>[]) => rows.map(({ story, measure: id, version, value, unit, commit, committed, machine, runs }) => ({ story, measure: id, version, value, unit, commit, committed, machine, runs }));
  assert.deepEqual(kept(await series(alpha.id, lines.id)), [at(4, alpha.id, first, "2026-11-10T12:00:00.000Z")], "Alpha's source lines at origin/main, not the working tree's");
  assert.deepEqual(kept(await series(beta.id, lines.id)), [at(2, beta.id, first, "2026-11-10T12:00:00.000Z")], "a base measure is read for every story");
  assert.equal((await recorded()).length, 2, "no row for a reader giving none, a measure read on another machine or one that is not base");

  const same = await record.act({ machine: "mint" }, context, WORDS);
  assert.match(same.text, /already recorded/i);
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
