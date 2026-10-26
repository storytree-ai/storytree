import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { removeTemp } from "@storytree/test-waits";

import { sanitiseSeed } from "@storytree/forest/evidence-seed";

import { scrubEvidence, seedFilesFor, seedRecordProblems } from "./seed-records.mjs";

/** One of the owner's test laptops, joined at run time so this file does not name it. */
const laptop = ["win", "lap"].join("");

function folder(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "seed-records-"));
  t.after(() => removeTemp(root));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  return root;
}

test("7.10 · the gate's seed check reads each seed or snapshot file the branch changes, gzipped or not, and refuses one holding a work record or a redaction pattern, naming the file", (t) => {
  const dirty = JSON.stringify({ changes: { changes: [{ recordId: "increment_a", type: "increment", record: { id: "increment_a", type: "increment", fields: {} } }] } });
  const clean = JSON.stringify({ tree: { stories: [{ id: "story_a", title: "The library" }] } });
  const root = folder(t, {
    "packages/forest/src/view/evidence/a/seed.json.gz": gzipSync(dirty),
    "packages/forest/src/view/evidence/b/seed.json": clean,
    "packages/forest/src/view/evidence/c/investigation-seed.json": JSON.stringify({ note: `ran on ${laptop}` }),
    "packages/website/src/forest-snapshot.json": clean,
    "packages/forest/src/view/evidence/a/survey.json": dirty,
  });
  const changed = ["packages/forest/src/view/evidence/a/seed.json.gz", "packages/forest/src/view/evidence/a/survey.json", "packages/forest/src/view/evidence/b/seed.json",
    "packages/forest/src/view/evidence/c/investigation-seed.json", "packages/website/src/forest-snapshot.json", "packages/gone/seed.json"];
  const files = seedFilesFor(root, () => changed);
  assert.deepEqual(files, ["packages/forest/src/view/evidence/a/seed.json.gz", "packages/forest/src/view/evidence/b/seed.json", "packages/forest/src/view/evidence/c/investigation-seed.json", "packages/website/src/forest-snapshot.json"]);
  const problems = seedRecordProblems(root, files);
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems[0], /a\/seed\.json\.gz holds an increment record/);
  assert.match(problems[1], /investigation-seed\.json carries a machine name/);
  assert.deepEqual(seedRecordProblems(root, seedFilesFor(root, () => ["packages/forest/src/view/evidence/b/seed.json"])), []);
});

test("7.12 · the gate's seed check also reads each transcript, log, table or CPU profile under an evidence folder the branch changes, refusing one that is UTF-16 or carries a home folder, session id or connector, and the evidence scrub rewrites a folder's captures so the check passes", (t) => {
  const transcript = `${JSON.stringify({ type: "system", cwd: "/home/someone/tipjar", session_id: "abc" })}\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - √ Connected\n`;
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("ran fine\n", "utf16le")]);
  const root = folder(t, {
    "packages/app-setup/evidence/run/turn-1.jsonl": transcript,
    "packages/app-setup/evidence/run/run.log": utf16,
    "packages/app-setup/evidence/run/costs.tsv": "turn\tusd\n1\t0.40\n",
    "packages/app-setup/evidence/run/profile.cpuprofile": JSON.stringify({ nodes: [{ callFrame: { url: "file:///home/someone/a.js" } }] }),
    "packages/app-setup/evidence/run/notes.txt": `tested on ${laptop}\n`,
    "packages/app-setup/src/turn.jsonl": transcript,
  });
  const changed = ["packages/app-setup/evidence/run/turn-1.jsonl", "packages/app-setup/evidence/run/run.log", "packages/app-setup/evidence/run/costs.tsv",
    "packages/app-setup/evidence/run/profile.cpuprofile", "packages/app-setup/evidence/run/notes.txt", "packages/app-setup/src/turn.jsonl"];
  const files = seedFilesFor(root, () => changed);
  assert.deepEqual(files, ["packages/app-setup/evidence/run/costs.tsv", "packages/app-setup/evidence/run/profile.cpuprofile", "packages/app-setup/evidence/run/run.log", "packages/app-setup/evidence/run/turn-1.jsonl"]);
  const problems = seedRecordProblems(root, files).join("\n");
  assert.match(problems, /profile\.cpuprofile carries a Linux home folder/);
  assert.match(problems, /run\.log is UTF-16/);
  assert.match(problems, /turn-1\.jsonl carries a session id/);
  assert.match(problems, /turn-1\.jsonl carries a connector line/);
  assert.doesNotMatch(problems, /costs\.tsv/);

  const scrubbed = scrubEvidence(path.join(root, "packages/app-setup/evidence/run"));
  assert.deepEqual(scrubbed.map((file) => path.basename(file)), ["notes.txt", "profile.cpuprofile", "run.log", "turn-1.jsonl"]);
  assert.deepEqual(seedRecordProblems(root, files), []);
  assert.equal(readFileSync(path.join(root, "packages/app-setup/evidence/run/run.log"), "utf8"), "ran fine\n");
  assert.equal(readFileSync(path.join(root, "packages/app-setup/evidence/run/notes.txt"), "utf8"), "tested on <test-laptop>\n");
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "packages/app-setup/evidence/run/turn-1.jsonl"), "utf8").trim()), { type: "system", cwd: "<home>/tipjar" });
});

test("7.13 · the gate's seed check refuses a website snapshot holding an increment's objective, outcome or body, a question, a writer named other than by role, or a withheld arc, and passes one keeping titles and status", (t) => {
  const record = (id, type, fields) => ({ id, type, version: 1, createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z", fields });
  const snapshot = (increment, extra = {}) => JSON.stringify({ version: 1, arcs: [{ state: "active", arc: record("arc_open", "arc", { title: "Open", priority: 1 }),
    increments: [record("increment_a", "increment", increment)], questions: [], ...extra }], holds: { waits: {}, heldOn: {} }, recording: { lines: [{ seq: 1, kind: "landed", scribedBy: "owner", writer: "agent" }] } });
  const kept = { arc: "arc_open", title: "Build it", status: "closed", parked: "2026-10-25T00:00:00.000Z", capabilities: ["capability_a"], disposition: "landed", pr: "7" };
  const file = "packages/website/src/forest-snapshot.json";
  const root = folder(t, {
    [file]: snapshot({ ...kept, objective: "It works", outcome: { disposition: "landed", note: "Landed" }, body: "How", scribedBy: "someone" },
      { questions: [record("question_a", "question", { arc: "arc_open", title: "Which?", lifecycle: "settled", answer: "A" })], named: ["arc_824a506f2125", "arc_bfbc3b617d69"] }),
    "clean/forest-snapshot.json": snapshot(kept),
  });
  const problems = seedRecordProblems(root, [file]).join("\n");
  assert.match(problems, /increment_a keeps its objective/);
  assert.match(problems, /increment_a keeps its outcome/);
  assert.match(problems, /increment_a keeps its body/);
  assert.match(problems, /holds a question record \(question_a\)/);
  assert.match(problems, /names a writer other than by role in scribedBy/);
  assert.match(problems, /names a withheld arc \(arc_824a506f2125\)/);
  assert.match(problems, /names a withheld arc \(arc_bfbc3b617d69\)/);
  assert.deepEqual(seedRecordProblems(root, ["clean/forest-snapshot.json"]), []);
});

test("7.13 · the gate's seed check refuses a website snapshot keeping a wait's reason or a recorded line's reason, why or session name, and passes one with them blank", (t) => {
  const snapshot = (reason, line) => JSON.stringify({ version: 1, arcs: [], holds: { waits: { increment_a: [{ on: "increment_b", reason, forGood: false }] }, heldOn: {} },
    recording: { lines: [{ seq: 1, kind: "claimed", increment: "increment_a", ...line }] } });
  const file = "packages/website/src/forest-snapshot.json";
  const root = folder(t, {
    [file]: snapshot("Plan order", { reason: "Build it", why: "Done", title: "A name" }),
    "clean/forest-snapshot.json": snapshot("", { reason: "" }),
  });
  const problems = seedRecordProblems(root, [file]).join("\n");
  assert.match(problems, /increment_a's wait on increment_b keeps its reason/);
  for (const field of ["reason", "why", "title"]) assert.match(problems, new RegExp(`recorded line 1 keeps its ${field}`));
  assert.doesNotMatch(problems, /Plan order|Build it|Done|A name/, "the problem never quotes the text it found");
  assert.deepEqual(seedRecordProblems(root, ["clean/forest-snapshot.json"]), []);
});

test("7.13 · the gate's seed check reads the website's shop snapshot too, refusing one that names a session by its harness id and passing it once sessions are numbered", (t) => {
  const shop = (session) => JSON.stringify({ version: 1, stages: [{ id: "building", wisps: [{ session, story: "story_a" }] }],
    reading: { recording: { lines: [{ seq: 1, kind: "landed", session, holder: session }] } } });
  const file = "packages/website/src/shop-snapshot.json";
  const root = folder(t, { [file]: shop("0b6c1f7e-2d4a-4c1b-9e5f-7a8b9c0d1e2f"), "clean/shop-snapshot.json": shop("session-1") });
  assert.deepEqual(seedFilesFor(root, () => [file]), [file]);
  assert.match(seedRecordProblems(root, [file]).join("\n"), /names a session in holder/);
  assert.deepEqual(seedRecordProblems(root, ["clean/shop-snapshot.json"]), []);
});

test("7.10 · the gate's seed check refuses a seed naming a writer other than by role or the published-copies arc, and passes it once it is sanitised", (t) => {
  const dump = { changes: { changes: [
    { seq: 1, recordId: "story_a", type: "story", record: { id: "story_a", type: "story", scribedBy: "someone", fields: { title: "The library" } } },
    { seq: 2, recordId: "decision_a", type: "decision", record: { id: "decision_a", type: "decision", scribedBy: "owner", fields: { text: "see arc_824a506f2125" } } },
  ] } };
  const file = "packages/forest/src/view/evidence/a/seed.json.gz";
  const root = folder(t, { [file]: gzipSync(JSON.stringify(dump)), "clean/seed.json": JSON.stringify(sanitiseSeed(dump)) });
  const problems = seedRecordProblems(root, [file]).join("\n");
  assert.match(problems, /a\/seed\.json\.gz names a writer other than by role in scribedBy/);
  assert.match(problems, /a\/seed\.json\.gz names a withheld arc \(arc_824a506f2125\)/);
  assert.deepEqual(seedRecordProblems(root, ["clean/seed.json"]), []);
});
