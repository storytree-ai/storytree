// Capability 1 · Base structure measures
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { DoorWords, VerbContext } from "@storytree/library/verbs";
import { withLibrary } from "@storytree/library/testing/pg";
import { removeTemp } from "@storytree/test-waits";

import { readStoryMeasures } from "./index.js";
import { CODE_MEASURES_FAMILIES } from "./verbs.js";

const ALPHA = { id: "story_a1a1a1a1a1a1", title: "Alpha tools" };
const BETA = { id: "story_b2b2b2b2b2b2", title: "Beta kit" };
const STORIES = [ALPHA, BETA];

interface Repository {
  readonly folder: string;
  readonly commits: readonly [string, string, string];
  git(...args: string[]): string;
}

async function repository(t: TestContext): Promise<Repository> {
  const folder = mkdtempSync(path.join(tmpdir(), "code-measures-"));
  t.after(() => removeTemp(folder));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  };
  const commit = (when: string, message: string) => {
    git("add", "-A");
    execFileSync("git", ["-c", "user.name=Measures test", "-c", "user.email=measures@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message], {
      cwd: folder,
      env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
    });
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  write("package.json", '{ "name": "fixture", "private": true }\n');
  write("packages/alpha-tools/package.json", '{ "name": "@ws/alpha-tools", "exports": { ".": "./src/a.ts" } }\n');
  write("packages/alpha-tools/src/a.ts", "export function a(x: number): number {\n  if (x > 0) return x;\n  return -x;\n}\n");
  const c1 = commit("2026-01-01T12:00:00Z", "alpha");
  write("packages/alpha-tools/src/a.ts", "export function a(x: number): number {\n  if (x > 0) return x;\n  return 0;\n}\n");
  const c2 = commit("2026-05-01T12:00:00Z", "alpha edited");
  write("packages/alpha-tools/src/a.ts", "export function a(x: number): number {\n  if (x > 0) return x;\n  return 0;\n}\nexport const extra = 1;\nexport const more = 2;\n");
  write("packages/beta-kit/package.json", '{ "name": "@ws/beta-kit", "exports": { ".": "./src/b.ts" } }\n');
  write("packages/beta-kit/src/b.ts", 'import { a } from "@ws/alpha-tools";\nexport const b = a(1);\n');
  const c3 = commit("2026-05-10T12:00:00Z", "alpha grown, beta added");
  write("packages/alpha-tools/src/a.ts", `${readFileSync(path.join(folder, "packages/alpha-tools/src/a.ts"), "utf8")}export const dirty = 3;\n`);
  write("packages/alpha-tools/src/new.ts", "export const untracked = 4;\n");
  return { folder, commits: [c1, c2, c3], git };
}

function checkoutState(repo: Repository): unknown {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(repo.folder, dir), { withFileTypes: true })) {
      const at = path.posix.join(dir, entry.name);
      if (entry.name === ".git") continue;
      if (entry.isDirectory()) walk(at);
      else files[at] = readFileSync(path.join(repo.folder, at), "utf8");
    }
  };
  walk("");
  return { head: repo.git("rev-parse", "HEAD"), refs: repo.git("for-each-ref"), status: repo.git("status", "--porcelain=v1", "--untracked-files=all"), files };
}

test("1.1 · a story none of whose packages is in the checkout at the commit measured is listed with that reason, never as zeros", async (t) => {
  const repo = await repository(t);
  const [, c2] = repo.commits;
  const read = await readStoryMeasures({ folder: repo.folder, commit: c2, stories: STORIES });
  const beta = read.stories.find((story) => story.id === BETA.id);
  assert.ok(beta !== undefined, "the story is listed");
  assert.match(beta.missing ?? "", /beta-kit/, "its reason names the package not in the checkout");
  assert.equal(beta.size, undefined, "and it reads no size, not zeros");
});

test("1.6 · churn is read over the window ending at the commit measured, 90 days by default: an edit 120 days before it is outside", async (t) => {
  const repo = await repository(t);
  const [, c2] = repo.commits;
  const read = await readStoryMeasures({ folder: repo.folder, commit: c2, stories: [ALPHA] });
  const alpha = read.stories.find((story) => story.id === ALPHA.id);
  assert.equal(alpha?.churn?.added, 1, "c2's added line; c1's four lines are 120 days before c2");
  assert.equal(alpha?.churn?.deleted, 1);
  assert.equal(alpha?.churn?.relative, 2 / 4);
});

test("1.7 · stories are read at the commit given, not the working tree, one story by id or by title or every one, and the checkout is left exactly as it was", async (t) => {
  const repo = await repository(t);
  const [, c2, c3] = repo.commits;
  const before = checkoutState(repo);

  const atC2 = await readStoryMeasures({ folder: repo.folder, commit: c2, stories: STORIES });
  assert.deepEqual(atC2.stories.map((story) => story.id), [ALPHA.id, BETA.id]);
  assert.deepEqual(atC2.stories[0]!.size, { files: 1, sourceLines: 4, testLines: 0, commentLines: 0, commentShare: 0 });

  const atC3 = await readStoryMeasures({ folder: repo.folder, commit: c3, stories: STORIES });
  assert.deepEqual(atC3.stories[0]!.size, { files: 1, sourceLines: 6, testLines: 0, commentLines: 0, commentShare: 0 }, "c3's a.ts, not the edited working copy nor the untracked file");
  assert.deepEqual(atC3.stories[1]!.size, { files: 1, sourceLines: 2, testLines: 0, commentLines: 0, commentShare: 0 });

  const byTitle = await readStoryMeasures({ folder: repo.folder, commit: c3, stories: STORIES, story: "Beta kit" });
  assert.deepEqual(byTitle.stories.map((story) => story.id), [BETA.id]);
  const byId = await readStoryMeasures({ folder: repo.folder, commit: c3, stories: STORIES, story: BETA.id });
  assert.deepEqual(byId.stories.map((story) => story.id), [BETA.id]);

  assert.deepEqual(checkoutState(repo), before, "HEAD, refs, status and every file are as they were");
});

test("1.7 · an unknown story or an unreadable commit is refused, naming it", async (t) => {
  const repo = await repository(t);
  const [, , c3] = repo.commits;
  await assert.rejects(readStoryMeasures({ folder: repo.folder, commit: c3, stories: STORIES, story: "Gamma works" }), /Gamma works/);
  await assert.rejects(readStoryMeasures({ folder: repo.folder, commit: "f00dfeedf00dfeed", stories: STORIES }), /f00dfeedf00dfeed/);
});

const testsOf = (story: object): unknown => (story as { tests?: unknown }).tests;

test("1.8 · a story's test count is the calls of test or it, their only, skip and todo forms included, whose first argument is a string or template title, across its packages' test files at the commit measured: a call with no title, a mention in a string, a source file's calls and a test file that does not parse count none", async (t) => {
  const repo = await repository(t);
  const [, , c3] = repo.commits;
  const beforeTests = await readStoryMeasures({ folder: repo.folder, commit: c3, stories: STORIES });
  assert.deepEqual(beforeTests.stories.map(testsOf), [{ count: 0 }, { count: 0 }], "a measured story with no test file counts 0, never none");

  const files: Record<string, string> = {
    "packages/alpha-tools/src/a.test.ts": [
      'import { describe, it, test } from "node:test";',
      'import { a } from "./a.js";',
      "const name = \"named elsewhere\";",
      'const mention = \'test("only a mention in a string")\';',
      'test("1.1 · a reads its value", () => { a(1); });',
      'test.only("only this one", () => {});',
      'it("it counts too", () => {});',
      "it.skip(`a template title ${mention}`, () => {});",
      'test.todo("still to write");',
      'describe("a group is no test", () => {',
      '  it("inside a group", () => {});',
      '  test.skip("skipped inside a group");',
      "});",
      "test(name, () => {});",
      "test(() => {});",
      'tests("no such call");',
      "",
    ].join("\n"),
    "packages/alpha-tools/src/c.spec.ts": ['import { it, test } from "node:test";', 'it("a spec counts");', "test.only(`a spec template`, () => {});", ""].join("\n"),
    "packages/alpha-tools/src/broken.test.ts": ['import { test } from "node:test";', 'test("one", () => {});', 'test("two", () => {', ""].join("\n"),
    "packages/alpha-tools/src/selfcheck.ts": ['export function test(title: string): string { return title; }', 'test("a source file counts none");', ""].join("\n"),
    "packages/beta-kit/src/b.test.ts": ['import { test } from "node:test";', 'test("b is one", () => {});', 'test("b is still one", () => {});', ""].join("\n"),
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo.folder, file)), { recursive: true });
    writeFileSync(path.join(repo.folder, file), text);
  }
  repo.git("add", ...Object.keys(files));
  repo.git("-c", "user.name=Measures test", "-c", "user.email=measures@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "tests added");
  const c4 = repo.git("rev-parse", "HEAD");
  writeFileSync(path.join(repo.folder, "packages/beta-kit/src/b.test.ts"), `${files["packages/beta-kit/src/b.test.ts"]}test("uncommitted", () => {});\n`);

  const read = await readStoryMeasures({ folder: repo.folder, commit: c4, stories: STORIES });
  assert.deepEqual(read.stories.map((story) => ({ id: story.id, tests: testsOf(story) })), [
    { id: ALPHA.id, tests: { count: 9 } },
    { id: BETA.id, tests: { count: 2 } },
  ], "Alpha: seven in a.test.ts and two in c.spec.ts; Beta: its two committed tests, not the working tree's third");

  const missing = await readStoryMeasures({ folder: repo.folder, commit: repo.commits[1], stories: [BETA] });
  assert.equal(testsOf(missing.stories[0]!), undefined, "a story not in the checkout carries no test count");
});

test("1.9 · a story's measures at the commit carry its erosion share, read from its source files there", async (t) => {
  const repo = await repository(t);
  const ifs = Array.from({ length: 10 }, (_, n) => `  if (x > ${n}) x--;`);
  mkdirSync(path.join(repo.folder, "packages/alpha-tools/src"), { recursive: true });
  writeFileSync(path.join(repo.folder, "packages/alpha-tools/src/big.ts"), ["export function big(x: number): number {", ...ifs, "  return x;", "}", ""].join("\n"));
  repo.git("add", "packages/alpha-tools/src/big.ts");
  repo.git("-c", "user.name=Measures test", "-c", "user.email=measures@example.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "big added");
  const c4 = repo.git("rev-parse", "HEAD");

  const read = await readStoryMeasures({ folder: repo.folder, commit: c4, stories: [ALPHA] });
  const erosion = (read.stories[0] as { erosion?: { mass: number; eroded: number; share: number } }).erosion;
  assert.ok(erosion !== undefined, "the story's measures carry erosion");
  const all = 2 * Math.sqrt(4) + 11 * Math.sqrt(13);
  const over = 11 * Math.sqrt(13);
  assert.ok(Math.abs(erosion.mass - all) < 1e-9, `mass ${erosion.mass}, expected ${all}: a (CC 2, 4 lines) and big (CC 11, 13 lines)`);
  assert.ok(Math.abs(erosion.eroded - over) < 1e-9, `eroded ${erosion.eroded}, expected ${over}`);
  assert.ok(Math.abs(erosion.share - over / all) < 1e-9, `share ${erosion.share}, expected ${over / all}`);
});

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("1.4 · coupling is read across the workspace at the commit measured, each package known by its manifest's name: Beta kit imports Alpha tools as @ws/alpha-tools", async (t) => {
  const repo = await repository(t);
  const [, , c3] = repo.commits;
  const read = await readStoryMeasures({ folder: repo.folder, commit: c3, stories: STORIES });
  const [alpha, beta] = read.stories;
  assert.deepEqual(alpha!.coupling, { dependencies: [], dependents: ["beta-kit"], instability: 0 });
  assert.deepEqual(beta!.coupling, { dependencies: ["alpha-tools"], dependents: [], instability: 1 });
});

test("1.7 · the code-measures family's bare verb prints the readings, as data with --json, with no verdict, writing nothing to the library, and answers for a story it cannot measure", async (t) => {
  const repo = await repository(t);
  const [, c2] = repo.commits;
  const family = CODE_MEASURES_FAMILIES.find((one) => one.name === "code-measures");
  assert.ok(family?.bare !== undefined, "the family is code-measures, its readings its bare verb");
  assert.equal(family.bare.writes, undefined, "it declares no write");

  await withLibrary(async (library) => {
    const alpha = await library.addStory({ title: ALPHA.title });
    await library.addStory({ title: BETA.title });
    const before = { changes: await library.latestChanges(), stories: await library.list("story") };
    const context: VerbContext = { folder: repo.folder, project: library.name, session: "s", library };
    const inputs = { story: undefined, commit: c2, since: undefined };

    const data = await family.bare!.act({ ...inputs, json: true }, context, WORDS);
    assert.equal(data.raw, true);
    const parsed = JSON.parse(data.text) as { stories: { id: string; title: string; size?: unknown; missing?: string; churn?: { added: number; deleted: number } }[] };
    assert.deepEqual(parsed.stories.map(({ title }) => title), ["Alpha tools", "Beta kit"], "every story in the library, read from the library");
    assert.equal(parsed.stories[0]!.id, alpha.id);
    assert.deepEqual(parsed.stories[0]!.size, { files: 1, sourceLines: 4, testLines: 0, commentLines: 0, commentShare: 0 }, "c2's a.ts, as data");
    assert.deepEqual([parsed.stories[0]!.churn?.added, parsed.stories[0]!.churn?.deleted], [1, 1]);
    assert.match(parsed.stories[1]!.missing ?? "", /beta-kit/);
    assert.equal(parsed.stories[1]!.size, undefined);

    const text = await family.bare!.act({ ...inputs, json: false }, context, WORDS);
    assert.match(text.text, /Alpha tools/);
    assert.match(text.text, /Beta kit/, "the story it cannot measure is listed, and the verb still answers");
    assert.doesNotMatch(text.text, /\b(threshold|pass(ed)?|fail(ed|s)?|verdict)\b/i, "report only: no verdict");

    assert.deepEqual({ changes: await library.latestChanges(), stories: await library.list("story") }, before, "nothing written to the library");
  });
});
