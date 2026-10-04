import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Change } from "@storytree/library";
import { ownStages } from "./own-growth.js";

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 26, hour, minute)).toISOString();
const created = (seq: number, type: string, id: string, when: string, fields: object = {}) =>
  ({ seq, recordId: id, type, action: "created", record: { id, type, version: 1, fields, createdAt: when, updatedAt: when } }) as unknown as Change;
const updated = (seq: number, type: string, id: string, when: string) =>
  ({ seq, recordId: id, type, action: "updated", record: { id, type, version: 2, fields: {}, createdAt: at(0), updatedAt: when } }) as unknown as Change;

test("3.8 · storytree's own growth is sampled from its dated history: empty, each story's arrival, stages spaced by its notes, complete", () => {
  const changes = [
    created(1, "story", "story_a", at(1)),
    created(2, "decision", "decision_1", at(2)), created(3, "decision", "decision_2", at(3)),
    created(4, "story", "story_b", at(4)), created(5, "story", "story_c", at(4, 0.2)),
    created(6, "principle", "principle_1", at(5)), created(7, "decision", "decision_3", at(6)), created(8, "decision", "decision_4", at(7)),
    updated(9, "decision", "decision_1", at(8)),
    created(10, "health", "health_x", at(9)),
  ];
  const merges = [{ at: at(10), subject: "Merge pull request #1" }];
  const { window, stages } = ownStages(changes, merges, { notes: 2 });
  const time = (value: string) => Date.parse(value);
  assert.ok(time(window.from) < time(at(1)) && time(window.to) > time(at(10)), "the window holds every record and landing");
  assert.equal(stages[0]!.id, "empty");
  assert.equal(stages.at(-1)!.id, "complete");
  assert.ok(stages.every(stage => time(stage.at) >= time(window.from) && time(stage.at) < time(window.to)));
  assert.deepEqual(stages.map(stage => time(stage.at)), [...stages].map(stage => time(stage.at)).sort((a, b) => a - b), "in recorded order");
  const arrived = (story: string) => stages.find(stage => stage.id.includes(story));
  assert.ok(arrived("story_a") && time(arrived("story_a")!.at) >= time(at(1)) && time(arrived("story_a")!.at) < time(at(2)), "story a's island arrives before the next record");
  assert.equal(arrived("story_b"), arrived("story_c"), "stories made in the same minute arrive together");
  // Five notes in two-note steps: stages after the 2nd and 4th notes were recorded, and the last is in complete.
  const notesBy = (stage: { at: string }) => changes.filter(change => change.type !== "story" && change.type !== "health" && change.action === "created" && time(change.record.updatedAt) <= time(stage.at)).length;
  assert.deepEqual(stages.filter(stage => stage.id.startsWith("notes")).map(notesBy), [2, 4]);
  assert.equal(new Set(stages.map(stage => stage.id)).size, stages.length, "every stage is named once");
});

test("3.8 · storytree's own refresh command saves its growth from a saved record and its code, each stage drawing only what was recorded by then", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "website-own-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "packages", "forest", "src"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
  await writeFile(path.join(repository, "packages", "forest", "package.json"), JSON.stringify({ name: "forest" }));
  await writeFile(path.join(repository, "packages", "forest", "src", "draw.js"), "export const draw = () => true;\n");
  execFileSync("git", ["add", "-A"], { cwd: repository });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "draw"], { cwd: repository, env: { ...process.env, GIT_AUTHOR_DATE: at(3), GIT_COMMITTER_DATE: at(3) } });

  const untested = { reported: { state: "not-checked" }, verified: { state: "not-checked" } };
  const record = { project: "storytree", capturedAt: at(12), lines: [],
    tree: { arcs: [], unverified: true, stories: [
      { id: "story_f", title: "The forest", description: "", health: untested, capabilities: [] },
      { id: "story_l", title: "The librarian", description: "", health: untested, capabilities: [] }] },
    changes: [created(1, "story", "story_f", at(1), { title: "The forest" }), created(2, "decision", "decision_1", at(2), { title: "Draw it", number: 1 }),
      created(3, "story", "story_l", at(5), { title: "The librarian" }), created(4, "decision", "decision_2", at(6), { title: "Keep it", number: 2 })] };
  const saved = path.join(directory, "record.json");
  await writeFile(saved, JSON.stringify(record));
  const output = path.join(directory, "own.json");
  const command = fileURLToPath(new URL("./refresh-own.ts", import.meta.url));
  const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), command, ...args],
    { cwd: directory, timeout: 30_000, env: { ...process.env, STORYTREE_EMBEDDER: "off" } });

  const ran = await run("--record", saved, "--repository", repository, "--branch", "main", "--output", output);
  assert.match(ran.stdout, /Saved storytree's own growth: \d+ stages/);
  const own = JSON.parse(await readFile(output, "utf8"));
  assert.equal(own.project, "storytree");
  const stage = (id: string) => own.stages.find((item: { id: string }) => item.id.includes(id));
  assert.equal(stage("story_f").counts.stories, 1, "only the forest stood when its island arrived");
  assert.equal(stage("story_f").scene.islands[0].land, undefined, "no code was committed by then");
  assert.equal(own.stages.at(-1).counts.stories, 2);
  assert.deepEqual(own.stages.at(-1).scene.islands.find((island: { story: string }) => island.story === "story_f").land.files.map((file: { path: string }) => file.path), ["src/draw.js"]);
  assert.deepEqual(own.changes.filter((change: { type: string }) => change.type === "decision").map((change: { record: { fields: { title: string } } }) => change.record.fields.title), ["Draw it", "Keep it"], "the core grows from its notes");

  const unchanged = await readFile(output, "utf8");
  await writeFile(saved, JSON.stringify({ ...record, project: "shop" }));
  await assert.rejects(run("--record", saved, "--repository", repository, "--branch", "main", "--output", output), /The record is of shop, not storytree/);
  assert.equal(await readFile(output, "utf8"), unchanged);
});
