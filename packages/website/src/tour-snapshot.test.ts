import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { refreshTourSnapshot, type TourReading } from "./tour-snapshot.js";

const at = "2026-10-02T00:00:00.000Z";
const until = "2026-10-02T01:00:00.000Z";
const health = { reported: { state: "passing" }, verified: { state: "not-checked" } };
function reading(): TourReading {
  const record = (id: string, type: string, fields: object) => ({ id, type, version: 1, fields, createdAt: at, updatedAt: at });
  const line = (seq: number, kind: string, extra = {}) => ({ seq, kind, at, project: "example", session: "session_example", source: "hook", ...extra });
  return {
    project: "example", capturedAt: until, window: { from: at, to: until }, cloudProjectIds: ["private-cloud-123"],
    tree: { arcs: [], stories: [{ id: "story_example", title: "Example", description: "See /home/alice/code and C:\\Users\\Alice\\repo, /Users/bob/repo or ~/work; private-cloud-123.", health,
      capabilities: [{ id: "capability_example", title: "1 · Example", description: "A real capability", proposed: false, status: "untested", dependsOn: [], health, contracts: [] }], folder: "/private", extra: "DROP_ME" }] },
    changes: [{ seq: 1, recordId: "decision_example", type: "decision", action: "created", record: record("decision_example", "decision", { title: "A choice", number: 7, status: "accepted", frontCoverOf: "story_example", links: ["principle_example"], supersedes: [], story: "story_example", body: "DROP_ME", branch: "private" }) }],
    survey: { story_example: { files: [{ path: "src/main.ts", lines: 40, capability: "capability_example" }], imports: [{ from: "src/main.ts", to: "src/other.ts" }] } },
    arcs: [
      { arc: record("arc_open", "arc", { title: "Open", intent: "Intent", endState: "End" }), state: "active", increments: [], questions: [record("question_example", "question", { title: "Question", arc: "arc_open", stakes: "Stakes", statement: "Statement", context: "Context", options: "Options", analogy: "Analogy", diagram: "a → b", recommendation: "Recommendation", lifecycle: "open", raised: at })] },
      { arc: record("arc_closed", "arc", { title: "Closed" }), state: "closed", increments: [], questions: [] },
    ], holds: { waits: { arc_open: [], arc_closed: [] }, heldOn: {} },
    lines: [line(1, "session-started", { folder: "/home/alice", machine: "private-host", transcript: "private-log", branch: "private-branch" }),
      line(2, "note-read", { note: "decision_example", found: "id", read: "whole", agent: { subagent: "agent_example", task: "PRIVATE_TASK" } }),
      line(3, "subagent-started", { subagent: "agent_example", task: "PRIVATE_TASK" }),
      line(4, "command-run", { command: "DROP_ME" }),
      line(5, "session-ended", { at: until }),
      line(6, "session-named", { at: "2026-10-01T23:59:59.999Z", title: "Before" }),
      line(7, "session-started", { project: "other" })],
  } as unknown as TourReading;
}

async function saved(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "website-recording-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "snapshot.json");
}

test("3.1 · refresh keeps surveyed land, explanatory plan and knowledge, and the open board's complete question", async t => {
  const file = await saved(t);
  await refreshTourSnapshot(file, async () => reading());
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  assert.equal(snapshot.capturedAt, until);
  assert.equal(snapshot.scene.islands[0].land.files[0].path, "src/main.ts");
  assert.equal(snapshot.scene.islands[0].land.territories[0].lines, 40);
  assert.deepEqual(snapshot.scene.islands[0].land.imports, [{ from: "src/main.ts", to: "src/other.ts" }]);
  assert.equal(snapshot.places[0].id, "story_example");
  assert.equal(snapshot.tree.stories[0].capabilities[0].description, "A real capability");
  assert.deepEqual(snapshot.changes[0].record.fields, { title: "A choice", number: 7, status: "accepted", frontCoverOf: "story_example", links: ["principle_example"], supersedes: [], story: "story_example" });
  assert.deepEqual(snapshot.arcs.map((view: { arc: { id: string } }) => view.arc.id), ["arc_open"]);
  assert.deepEqual(snapshot.arcs[0].questions[0].fields, reading().arcs[0]!.questions[0]!.fields);
});

test("3.3 · recording is exactly the requested half-open time window, preserving project and scrubbing private data recursively", async t => {
  const file = await saved(t);
  await refreshTourSnapshot(file, async () => reading());
  const text = await readFile(file, "utf8");
  const snapshot = JSON.parse(text);
  assert.deepEqual(snapshot.recording.window, { from: at, to: until });
  assert.deepEqual(snapshot.recording.lines.map((line: { seq: number }) => line.seq), [1, 2, 3]);
  assert.ok(snapshot.recording.lines.every((line: { project: string }) => line.project === "example"));
  assert.doesNotMatch(text, /"(?:folder|machine|transcript|branch|task)"|DROP_ME|PRIVATE_TASK|private-cloud-123|\/home\/alice|\/Users\/bob|Alice|~\/work/);
  assert.match(snapshot.tree.stories[0].description, /\[home\]/);
  assert.match(snapshot.tree.stories[0].description, /\[cloud-project\]/);
});

test("3.2, 3.3 · credential-like retained text or an invalid window refuses refresh and preserves the saved file", async t => {
  const file = await saved(t);
  await writeFile(file, "last valid snapshot\n");
  for (const value of ["password=short", "client_secret=syntheticOAuthSecret123456789", "ghp_" + "a".repeat(36), "-----BEGIN PRIVATE KEY-----", "postgres://user:password@example.test/db", 'api_key="' + "a".repeat(30) + '"']) {
    const input = reading();
    input.tree.stories[0]!.description = value;
    await assert.rejects(refreshTourSnapshot(file, async () => input), /credential/i);
    assert.equal(await readFile(file, "utf8"), "last valid snapshot\n");
  }
  const input = reading();
  input.window = { from: until, to: at };
  await assert.rejects(refreshTourSnapshot(file, async () => input), /window/i);
  assert.equal(await readFile(file, "utf8"), "last valid snapshot\n");
});
