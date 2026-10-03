import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { refreshGrowthSnapshot, type GrowthReading } from "./conduit-growth.js";
import { codeAt } from "./shop-growth.js";

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
