import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { publicArcs, refreshTourSnapshot, scrub, type TourReading } from "./tour-snapshot.js";

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
      { arc: record("arc_open", "arc", { title: "Open", intent: "Intent", endState: "End" }), state: "active", increments: [], questions: [record("question_example", "question", { title: "Question", arc: "arc_open", stakes: "Stakes", statement: "Statement", context: "Context", options: "Options", analogy: "Analogy", diagram: "a → b", recommendation: "Recommendation", lifecycle: "open" })] },
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

test("3.1 · refresh keeps surveyed land, explanatory plan and knowledge, and the open board", async t => {
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

test("3.14 · the saved reading keeps of each arc only what the board draws: titles, status and close, never an objective, outcome note, body or question, never this arc or the hardening arc, and writers by role", async t => {
  const file = await saved(t);
  const input = reading();
  const view = input.arcs[0]! as unknown as { arc: { fields: object }; increments: unknown[]; questions: unknown[] };
  const record = (id: string, type: string, fields: object) => ({ id, type, version: 1, fields, createdAt: at, updatedAt: at });
  view.arc.fields = { ...view.arc.fields, priority: 2, authority: { basis: "owner-directed", scribedBy: "zelda", at } };
  view.increments.push(record("increment_example", "increment", { arc: "arc_open", title: "Build it", objective: "OBJECTIVE_TEXT", status: "closed", parked: at, capabilities: ["capability_example"], heldOn: ["question_example"],
    outcome: { date: at, disposition: "landed", pr: "7", note: "OUTCOME_NOTE" }, body: "BODY_TEXT", touches: ["DROP_ME"], remedies: ["DROP_ME"], scribedBy: "zelda" }));
  view.questions.push(record("question_settled", "question", { title: "Settled", arc: "arc_open", lifecycle: "settled", answer: "SETTLED_ANSWER", stakes: "S", statement: "S",
    context: "C", options: "O", analogy: "An", recommendation: "R", settledAt: at, leaseDays: 7, verifiedAt: at }));
  (input.arcs as unknown[]).push({ arc: record("arc_824a506f2125", "arc", { title: "Withheld" }), state: "active",
    increments: [record("increment_withheld", "increment", { arc: "arc_824a506f2125", title: "Withheld work" })], questions: [] });
  (input.changes as unknown[]).push({ seq: 2, recordId: "principle_naming", type: "principle", action: "created", record: record("principle_naming", "principle", { title: "Names it", links: ["arc_824a506f2125"] }) });
  input.holds = { waits: { increment_example: [] }, heldOn: { increment_example: ["question_example"] } } as never;
  input.tree.stories[0]!.description = "The owner's option C on question_90d62e4f7b9a.";
  (input.lines as unknown[]).push({ seq: 8, kind: "landed", at, project: "example", session: "session_example", source: "tool", scribedBy: "zelda", writer: "session:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" });
  await refreshTourSnapshot(file, async () => input);
  const text = await readFile(file, "utf8");
  const snapshot = JSON.parse(text);
  assert.doesNotMatch(text, /OBJECTIVE_TEXT|OUTCOME_NOTE|BODY_TEXT|SETTLED_ANSWER|"objective"|"outcome"|"heldOn":\[|question_|zelda|arc_824a506f2125|increment_withheld|principle_naming/);
  assert.deepEqual(snapshot.arcs.map((arc: { arc: { id: string } }) => arc.arc.id), ["arc_open"]);
  assert.deepEqual(snapshot.arcs[0].arc.fields, { title: "Open", priority: 2 });
  assert.deepEqual(snapshot.arcs[0].increments[0].fields, { arc: "arc_open", title: "Build it", status: "closed", parked: at, capabilities: ["capability_example"], disposition: "landed", pr: "7" });
  assert.deepEqual(snapshot.arcs[0].questions, []);
  assert.equal(snapshot.tree.stories[0].description, "The owner's option C on a question.");
  assert.deepEqual(snapshot.holds, { waits: { increment_example: [] }, heldOn: {} });
  const landed = snapshot.recording.lines.find((line: { seq: number }) => line.seq === 8);
  assert.deepEqual([landed.scribedBy, landed.writer], ["owner", "agent"]);
  assert.deepEqual(scrub({ scribedBy: "owner", settledBy: "agent", writer: "person:someone" }, []), { scribedBy: "owner", settledBy: "agent", writer: "owner" });
});

test("3.14 · the saved reading keeps no text a session or a wait wrote: a wait keeps what it waits on, a line its kind, and a session's name goes", async t => {
  const file = await saved(t);
  const input = reading();
  const record = (id: string, type: string, fields: object) => ({ id, type, version: 1, fields, createdAt: at, updatedAt: at });
  (input.arcs[0]!.increments as unknown[]).push(record("increment_waiting", "increment", { arc: "arc_open", title: "Waits", status: "proposal", parked: at, capabilities: [] }),
    record("increment_first", "increment", { arc: "arc_open", title: "First", status: "proposal", parked: at, capabilities: [] }));
  input.holds = { waits: { increment_waiting: [{ on: "increment_first", reason: "WAIT_REASON", forGood: false }] }, heldOn: {} };
  const line = (seq: number, kind: string, extra: object) => ({ seq, kind, at, project: "example", session: "session_example", source: "tool", ...extra });
  (input.lines as unknown[]).push(line(8, "claimed", { increment: "increment_waiting", reason: "CLAIM_REASON" }), line(9, "closed-out", { safe: true, why: "CLOSE_WHY" }),
    line(10, "session-named", { title: "SESSION_NAME" }), line(11, "released", { increment: "increment_waiting", reason: "RELEASE_REASON" }), line(12, "session-ended", { reason: "END_REASON" }));
  await refreshTourSnapshot(file, async () => input);
  const text = await readFile(file, "utf8");
  const snapshot = JSON.parse(text);
  assert.doesNotMatch(text, /WAIT_REASON|CLAIM_REASON|CLOSE_WHY|SESSION_NAME|RELEASE_REASON|END_REASON|session-named/);
  assert.deepEqual(snapshot.holds.waits, { increment_waiting: [{ on: "increment_first", reason: "", forGood: false }] });
  assert.deepEqual(snapshot.recording.lines.filter((kept: { seq: number }) => kept.seq >= 8).map(({ seq, kind, increment, safe }: Record<string, unknown>) => ({ seq, kind, increment, safe })),
    [{ seq: 8, kind: "claimed", increment: "increment_waiting", safe: undefined }, { seq: 9, kind: "closed-out", increment: undefined, safe: true },
      { seq: 11, kind: "released", increment: "increment_waiting", safe: undefined }, { seq: 12, kind: "session-ended", increment: undefined, safe: undefined }]);
});

test("3.16 · the saved reading drops the unlisted arc and every record naming it, gives sessions opaque ids, and replaces who and where", async t => {
  const file = await saved(t);
  const input = reading();
  const record = (id: string, type: string, fields: object) => ({ id, type, version: 1, fields, createdAt: at, updatedAt: at });
  const unlisted = { arc: record("arc_bfbc3b617d69", "arc", { title: "Unlisted" }), state: "active",
    increments: [record("increment_unlisted", "increment", { arc: "arc_bfbc3b617d69", title: "Unlisted work" })], questions: [] };
  (input.arcs as unknown[]).push(unlisted);
  (input.changes as unknown[]).push({ seq: 2, recordId: "principle_naming", type: "principle", action: "created", record: record("principle_naming", "principle", { title: "Names it", links: ["increment_unlisted"] }) });
  (input.lines as unknown[]).push({ seq: 8, kind: "claimed", at, project: "example", session: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", source: "tool", increment: "increment_unlisted" },
    { seq: 9, kind: "merged", at, project: "example", session: "person:alice", holder: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", source: "tool", pr: 7 });
  // One of the owner's machines, an address in the tailnet's range and the private links are joined at run time, so this file holds none.
  const laptop = ["Win", "Lap"].join("");
  input.tree.stories[0]!.description = `Ask ann@example.com or ssh pg_user@buildbox on ${laptop}, ` +
    `box.tail1234.ts.net or ${["100", "101", "102", "103"].join(".")}; written by person:alice in private-cloud-123 projects/123456789012; ` +
    `see ${["https://claude", "ai/code/session_x"].join(".")} and ${["https://docs", "google", "com/document/d/abc"].join(".")}. ` +
    "Reported by 0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.";
  await refreshTourSnapshot(file, async () => input);
  const text = await readFile(file, "utf8");
  const snapshot = JSON.parse(text);
  assert.doesNotMatch(text, new RegExp(`arc_bfbc3b617d69|increment_unlisted|principle_naming|ann@|pg_user|buildbox|${laptop}|ts\\.net|100\\.101|alice|private-cloud|123456789012|claude\\.ai|docs\\.google|0190a1b2`, "i"));
  assert.match(snapshot.tree.stories[0].description, /\[email\].*\[user at host\].*\[machine\].*\[address\].*person:\[someone\].*\[private link\].*session-1/);
  const merged = snapshot.recording.lines.find((line: { seq: number }) => line.seq === 9);
  assert.match(merged.session, /^session-\d+$/);
  assert.notEqual(merged.session, merged.holder);
  assert.ok(snapshot.tree.stories[0].description.endsWith(`Reported by ${merged.holder}.`), "one id becomes the same opaque one wherever it appears");
  assert.equal(new Set(snapshot.recording.lines.map((line: { session: string }) => line.session)).size, 2, "the sessions still tell apart");

  assert.deepEqual(publicArcs([unlisted as never]), []);
  const someone = new Set([createHash("sha256").update("Zelda").digest("hex")]);
  assert.equal(scrub("Zelda's laptop, and Zelda tried it; Won't change Zeldas", [], someone), "a friend tester's laptop, and a friend tester tried it; Won't change Zeldas");
  assert.equal(scrub(scrub("pg_user@buildbox person:alice", []), []), "[user at host] person:[someone]", "scrubbing twice changes nothing more");
});
