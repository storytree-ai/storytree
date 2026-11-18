/**
 * Code measures, capability 1 · Base structure measures, read from a git checkout at a commit: contracts 1.1 (a story whose
 * packages are not in the checkout), 1.6 (the churn window ends at the commit measured) and 1.7 (the code-measures verb
 * family reads at a commit without changing the checkout, one story or every one, refuses what it cannot read, writes
 * nothing). Each test makes a small git repository with scripted, dated commits.
 */
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

const ALPHA = { id: "story_a1a1a1a1a1a1", title: "Alpha tools" }; // packages/alpha-tools
const BETA = { id: "story_b2b2b2b2b2b2", title: "Beta kit" }; // packages/beta-kit, added only at the last commit
const STORIES = [ALPHA, BETA];

interface Repository {
  readonly folder: string;
  /** The commits, oldest first: c1 120 days before c2, c3 nine days after it. */
  readonly commits: readonly [string, string, string];
  git(...args: string[]): string;
}

/**
 * Three dated commits of packages/alpha-tools/src/a.ts (4 source lines at c1 and c2, 6 at c3), packages/beta-kit added
 * at c3, and a working tree that differs from every commit: a.ts edited and a new file not yet added.
 */
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
  const c2 = commit("2026-05-01T12:00:00Z", "alpha edited"); // one line added, one deleted
  write("packages/alpha-tools/src/a.ts", "export function a(x: number): number {\n  if (x > 0) return x;\n  return 0;\n}\nexport const extra = 1;\nexport const more = 2;\n");
  write("packages/beta-kit/package.json", '{ "name": "@ws/beta-kit", "exports": { ".": "./src/b.ts" } }\n');
  write("packages/beta-kit/src/b.ts", 'import { a } from "@ws/alpha-tools";\nexport const b = a(1);\n');
  const c3 = commit("2026-05-10T12:00:00Z", "alpha grown, beta added");
  write("packages/alpha-tools/src/a.ts", `${readFileSync(path.join(folder, "packages/alpha-tools/src/a.ts"), "utf8")}export const dirty = 3;\n`);
  write("packages/alpha-tools/src/new.ts", "export const untracked = 4;\n");
  return { folder, commits: [c1, c2, c3], git };
}

/** Everything a reading could change: HEAD, the refs, the index and working tree's status, and every file outside .git with its text. */
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
