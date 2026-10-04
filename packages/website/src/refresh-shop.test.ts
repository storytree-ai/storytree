import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const at = (minute: number) => `2026-10-03T16:${String(minute).padStart(2, "0")}:00.000Z`;
const untested = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };
const change = (seq: number, type: string, id: string, fields: object) =>
  ({ seq, recordId: id, type, action: "created", record: { id, type, version: 1, fields, createdAt: at(1), updatedAt: at(1) } });

test("3.5, 3.7, 3.9 · the shop's refresh command saves its growth and public reading from a saved record, its code and its archived CI runs on main", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "website-shop-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repository = path.join(directory, "repo");
  const src = path.join(repository, "packages", "have-an-account", "src");
  await mkdir(src, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
  await writeFile(path.join(repository, "packages", "have-an-account", "package.json"), JSON.stringify({ name: "have-an-account" }));
  await writeFile(path.join(src, "sign-in.js"), "export const signIn = () => true;\n");
  await writeFile(path.join(src, "sign-in.test.js"), `import { test } from "node:test";\nimport { signIn } from "./sign-in.js";\ntest("1.1 sign in works", () => signIn());\n`);
  execFileSync("git", ["add", "-A"], { cwd: repository });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "sign in"], { cwd: repository, env: { ...process.env, GIT_AUTHOR_DATE: at(2), GIT_COMMITTER_DATE: at(2) } });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();

  const arc = { id: "arc_a", type: "arc", version: 1, fields: { title: "Accounts", intent: "", endState: "" }, createdAt: at(1), updatedAt: at(1) };
  const record = { project: "shop", capturedAt: at(30),
    lines: [{ seq: 1, at: at(1), kind: "session-started", project: "shop", session: "s1", folder: "/home/someone/shop" }],
    arcs: [{ arc, state: "closed", increments: [], questions: [] }], holds: { waits: {}, heldOn: {} },
    tree: { arcs: [], unverified: true, stories: [{ id: "story_a", title: "Have an account", description: "", health: untested, capabilities: [
      { id: "capability_a1", title: "1 · Sign in", description: "", dependsOn: [], proposed: false, status: "untested", reportOnly: true, health: untested,
        contracts: [{ id: "contract_a11", title: "1.1 · Sign in works", description: "", health: untested }] }] }] },
    changes: [change(1, "story", "story_a", { title: "Have an account" }), change(2, "capability", "capability_a1", { story: "story_a", title: "1 · Sign in" }),
      change(3, "contract", "contract_a11", { capability: "capability_a1", title: "1.1 · Sign in works" })] };
  const saved = path.join(directory, "record.json");
  await writeFile(saved, JSON.stringify(record));
  const ci = path.join(directory, "ci");
  await mkdir(ci);
  await writeFile(path.join(ci, "runs.tsv"), "1\tpush\tmain\n2\tpull_request\tfeature\n");
  const finished = "2026-10-03T16:02:30.000Z";
  const log = (outcome: string) => [`test\tRun actions/checkout@v4\t${finished} [command]/usr/bin/git log -1 --format=%H`, `test\tRun actions/checkout@v4\t${finished} ${commit}`,
    `test\tRun npm test\t${finished} ${outcome} 1 - 1.1 sign in works`].join("\n");
  await writeFile(path.join(ci, "run-1.log"), log("ok"));
  await writeFile(path.join(ci, "run-2.log"), log("not ok"));
  const output = path.join(directory, "shop.json");
  const command = fileURLToPath(new URL("./refresh-shop.ts", import.meta.url));
  const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), command, ...args],
    { cwd: directory, timeout: 30_000, env: { ...process.env, STORYTREE_EMBEDDER: "off" } });

  const ran = await run("--repository", repository, "--record", saved, "--ci", ci, "--output", output);
  assert.match(ran.stdout, /Saved the shop's growth: 2 stages/);
  const shop = JSON.parse(await readFile(output, "utf8"));
  assert.equal(shop.project, "shop");
  const land = (stage: { scene: { islands: { land?: { files: { path: string }[]; territories: { capability?: string; status: string }[] } }[] } }) => stage.scene.islands[0]?.land;
  assert.equal(land(shop.stages[0]), undefined, "no code stood before the first commit");
  assert.deepEqual(land(shop.stages[1])!.files.map(file => file.path), ["src/sign-in.js"]);
  assert.equal(land(shop.stages[1])!.territories.find(item => item.capability === "capability_a1")!.status, "healthy", "only the push run on main colours the land");
  assert.equal(shop.scene.islands[0].land.territories.find((item: { capability?: string }) => item.capability === "capability_a1").status, "healthy");
  assert.deepEqual(shop.reading.tree.stories.map((story: { id: string }) => story.id), ["story_a"], "the plan is saved for the story panels");
  assert.equal(shop.reading.tree.stories[0].capabilities[0].health.verified.state, "passing", "with the health its CI verified");
  assert.deepEqual(shop.reading.arcs.map((view: { arc: { id: string } }) => view.arc.id), ["arc_a"], "closed arcs too: the shop is finished");
  assert.deepEqual(shop.reading.recording.lines, [{ seq: 1, at: at(1), kind: "session-started", project: "shop", session: "s1" }], "its activity, private fields removed");

  const unchanged = await readFile(output, "utf8");
  await writeFile(saved, JSON.stringify({ ...record, project: "conduit" }));
  await assert.rejects(run("--repository", repository, "--record", saved, "--output", output), /The record is of conduit, not shop/);
  await assert.rejects(run("--record", saved, "--output", output), /Give --repository/);
  assert.equal(await readFile(output, "utf8"), unchanged);
});
