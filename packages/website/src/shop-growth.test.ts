import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { refreshGrowthSnapshot, type GrowthReading } from "./saved-growth.js";
import { ciHealth, codeAt, shopStages } from "./shop-growth.js";

const t = (minute: number) => `2026-10-03T16:${String(minute).padStart(2, "0")}:00.000Z`;
const untested = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };

/** A repository whose main gains one file in the story's package at t(2), and a second at t(4). */
async function repository(root: string): Promise<string> {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const commit = (at: string, message: string) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message],
    { cwd: root, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } });
  git("init", "-q", "-b", "main");
  await mkdir(path.join(root, "packages", "have-an-account", "src"), { recursive: true });
  await writeFile(path.join(root, "packages", "have-an-account", "package.json"), JSON.stringify({ name: "have-an-account" }));
  await writeFile(path.join(root, "packages", "have-an-account", "src", "sign-in.js"), "export const signIn = () => true;\n");
  git("add", "-A");
  commit(t(2), "one file");
  await writeFile(path.join(root, "packages", "have-an-account", "src", "sign-out.js"), "export const signOut = () => true;\nexport const again = 1;\n");
  git("add", "-A");
  commit(t(4), "two files");
  return root;
}

function reading(code: GrowthReading["surveyAt"]): GrowthReading {
  const change = (seq: number, type: string, id: string, fields: object) =>
    ({ seq, recordId: id, type, action: "created", record: { id, type, version: 1, fields, createdAt: t(1), updatedAt: t(1) } });
  return {
    project: "shop", capturedAt: t(30), window: { from: t(0), to: t(10) },
    tree: { arcs: [], unverified: true, stories: [{ id: "story_a", title: "Have an account", description: "", health: untested, capabilities: [
      { id: "capability_a1", title: "1 · Sign in", description: "", dependsOn: [], proposed: false, status: "untested", reportOnly: true, health: untested, contracts: [] }] }] },
    changes: [change(1, "story", "story_a", { title: "Have an account" }), change(2, "capability", "capability_a1", { story: "story_a", title: "1 · Sign in" })],
    lines: [], stages: [{ id: "before", at: t(1) }, { id: "one", at: t(3) }, { id: "two", at: t(5) }], surveyAt: code,
  } as unknown as GrowthReading;
}

test("3.5 · a stage's land comes only from the survey of the code as it stood at the stage's time", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "shop-growth-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = await repository(await mkdtemp(path.join(directory, "repo-")));
  const file = path.join(directory, "shop.json");
  await refreshGrowthSnapshot(file, async () => reading(codeAt(root)));
  const saved = JSON.parse(await readFile(file, "utf8"));
  const files = (id: string) => saved.stages.find((stage: { id: string }) => stage.id === id).scene.islands[0].land?.files.map((item: { path: string }) => item.path).sort();
  assert.equal(files("before"), undefined, "no code was committed before the stage");
  assert.deepEqual(files("one"), ["src/sign-in.js"]);
  assert.deepEqual(files("two"), ["src/sign-in.js", "src/sign-out.js"]);
  assert.deepEqual(saved.scene.islands[0].land.files.map((item: { path: string }) => item.path).sort(), ["src/sign-in.js", "src/sign-out.js"], "the full plan's frame stands on the code at the window's end");
});

/** The shop's CI on main, archived as `gh run view --log` saves it: the commit its checkout printed, then its TAP. */
const ciLog = (commit: string, finished: string, outcome: "ok" | "not ok") => [
  `test\tRun actions/checkout@v4\t${finished} [command]/usr/bin/git log -1 --format=%H`,
  `test\tRun actions/checkout@v4\t${finished} ${commit}`,
  `test\tRun npm test\t${finished} ${outcome} 1 - 1.1 sign in works`,
].join("\n");

test("3.7 · the shop's saved growth colours each stage only by the CI results recorded by its time, and before any run its land reads as the agent's report alone", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "shop-ci-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = await mkdtemp(path.join(directory, "repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await mkdir(path.join(root, "packages", "have-an-account", "src"), { recursive: true });
  await writeFile(path.join(root, "packages", "have-an-account", "package.json"), JSON.stringify({ name: "have-an-account" }));
  await writeFile(path.join(root, "packages", "have-an-account", "src", "sign-in.js"), "export const signIn = () => true;\n");
  await writeFile(path.join(root, "packages", "have-an-account", "src", "sign-in.test.js"), `import { test } from "node:test";\nimport { signIn } from "./sign-in.js";\ntest("1.1 sign in works", () => signIn());\n`);
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "sign in"], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: t(2), GIT_COMMITTER_DATE: t(2) } });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  const recorded = reading(codeAt(root));
  const contract = { seq: 3, recordId: "contract_a11", type: "contract", action: "created", record: { id: "contract_a11", type: "contract", version: 1, fields: { capability: "capability_a1", title: "1.1 · Sign in works" }, createdAt: t(1), updatedAt: t(1) } };
  const tree = structuredClone(recorded.tree) as GrowthReading["tree"];
  tree.stories[0]!.capabilities[0]!.contracts = [{ id: "contract_a11", title: "1.1 · Sign in works", description: "", health: untested }] as never;
  const changes = [...recorded.changes, contract] as GrowthReading["changes"];
  const verified = await ciHealth({ tree, changes, repository: root, runs: [{ id: "1", log: ciLog(commit, t(4), "ok") }, { id: "2", log: ciLog(commit, t(6), "not ok") }] });
  const file = path.join(directory, "shop.json");
  await refreshGrowthSnapshot(file, async () => ({ ...recorded, tree: verified.tree, changes: verified.changes, stages: [{ id: "built", at: t(3) }, { id: "passed", at: t(5) }, { id: "failed", at: t(7) }] }));
  const saved = JSON.parse(await readFile(file, "utf8"));
  const territory = (id: string) => saved.stages.find((stage: { id: string }) => stage.id === id).scene.islands[0].land.territories.find((item: { capability?: string }) => item.capability === "capability_a1").status;
  assert.equal(territory("built"), "untested", "no CI run had finished: the land reads only what the agent reports");
  assert.equal(territory("passed"), "healthy", "the first run on main passed its test");
  assert.equal(territory("failed"), "unhealthy", "the next one failed it");
  assert.equal(saved.scene.islands[0].land.territories.find((item: { capability?: string }) => item.capability === "capability_a1").status, "unhealthy", "the full plan's frame stands on the last run");
});

test("3.11 · each increment has a stage while it was built and one once it landed, named by its pull request, merged or squashed", () => {
  const change = (minute: number) => ({ record: { updatedAt: t(minute) } }) as never;
  const line = (kind: string, minute: number, increment: string, session: string) => ({ kind, at: t(minute), increment, session }) as never;
  const lines = [line("claimed", 2, "increment_a", "s1"), line("claimed", 3, "increment_b", "s2"), line("closed", 11, "increment_a", "s1"), line("closed", 21, "increment_b", "s2")];
  const merges = [
    { at: t(1), subject: "Start the shop" },
    { at: t(10), subject: "Merge pull request #1 from someone/part-1" },
    { at: t(20), subject: "Part 2: the cart (#2)" },
  ];
  const { stages } = shopStages([change(1), change(25)], lines, merges);
  assert.deepEqual(stages.map(stage => stage.id), ["empty", "planned", "pr1-building", "pr1", "pr2-building", "pr2", "complete"]);
});
