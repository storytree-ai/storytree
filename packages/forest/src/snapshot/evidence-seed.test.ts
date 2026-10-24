import assert from "node:assert/strict";
import { test } from "node:test";

import { WITHHELD_ARCS, sanitiseSeed, seedProblems } from "./evidence-seed.js";

const withheld = WITHHELD_ARCS[0]!;
const leaks = [
  "owner@example.com", "mickh@mickh-a520i-ac", "C:\\Users\\someone\\code", "/home/someone/code", "box.tail0000.ts.net",
  "MicksMSpro", "winlap", "micksoldlaptop", "100.97.8.31", "storytree-498613",
  "https://claude.ai/artifact/AbC123", "https://claude.ai/code/session_1", "https://claude.ai/share/xyz",
  "https://docs.google.com/document/d/1", "https://drive.google.com/file/d/2",
].join(" and ");
const record = (id: string, type: string, fields: Record<string, unknown>) => ({ id, type, version: 1, fields });
const change = (seq: number, rec: ReturnType<typeof record>) => ({ seq, recordId: rec.id, type: rec.type, action: "created", record: rec });

function fixture() {
  const story = record("story_a", "story", { title: "The library", description: `kept, though it names ${leaks}` });
  const records = [
    story,
    record("capability_a", "capability", { title: "1 · Reads", story: "story_a" }),
    record("contract_a", "contract", { title: "1.1 · reads", capability: "capability_a" }),
    record("health_a", "health", { node: "contract_a", state: "passing" }),
    record("decision_a", "decision", { text: "a kept decision" }),
    record("arc_open", "arc", { title: "An open arc", intent: "plan prose", endState: "more prose", stories: ["story_a"] }),
    record(withheld, "arc", { title: "Withheld", intent: "withheld prose", stories: ["story_a"] }),
    record("decision_b", "decision", { text: `names ${withheld}` }),
    record("increment_a", "increment", { arc: "arc_open", body: "work" }),
    record("question_a", "question", { arc: "arc_open", title: "ask" }),
    record("wait_a", "wait", { on: "increment_a" }),
    record("friction_a", "friction", { text: "fought" }),
    record("resteer_a", "resteer", { text: "redirected" }),
  ];
  return {
    projects: ["storytree"],
    tree: {
      stories: [{ id: "story_a", title: "The library", description: leaks, capabilities: [], health: "verified" }],
      arcs: [
        { id: "arc_open", title: "An open arc", description: "plan prose", stories: ["story_a"] },
        { id: withheld, title: "Withheld", description: "withheld prose", stories: [] },
      ],
    },
    changes: { changes: records.map((one, at) => change(at + 1, one)), cursor: records.length },
    lines: { lines: [{ text: "a session ran on winlap" }], cursor: 3 },
    covers: { story_a: [records[4], records[7], records[8]] },
  };
}

test("3.69 · a dump passed through the seed sanitiser keeps stories, capabilities, contracts, health and knowledge, reduces arcs to id, title and stories, and drops work records, the withheld arc and every record naming it, and every redaction pattern", () => {
  const raw = fixture();
  const clean = sanitiseSeed(raw);
  const kinds = clean.changes.changes.map((one) => one.record.id);
  assert.deepEqual(kinds, ["story_a", "capability_a", "contract_a", "health_a", "decision_a", "arc_open"]);
  assert.deepEqual(clean.changes.changes.find((one) => one.type === "arc")!.record.fields, { title: "An open arc", stories: ["story_a"] });
  assert.deepEqual(clean.tree.arcs, [{ id: "arc_open", title: "An open arc", stories: ["story_a"] }]);
  assert.deepEqual(clean.tree.stories.map((story) => story.id), ["story_a"], "story ids stay");
  assert.deepEqual(clean.covers, { story_a: [raw.covers.story_a[0]] });
  assert.deepEqual(clean.lines, { lines: [], cursor: 3 });
  const text = JSON.stringify(clean);
  for (const leak of leaks.split(" and ")) assert.ok(!text.includes(leak), `${leak} is redacted`);
  assert.match(clean.tree.stories[0]!.description, /^<email> and <user@host> and <home>\\code and <home>\/code and <tailnet-host> and <machine>/);
  assert.deepEqual(seedProblems("seed.json", text), []);
  assert.deepEqual(raw.changes.changes.length, 13, "the dump it read is left as it was");
});

test("3.69 · the seed check names each work record kind, the withheld arc and each redaction pattern an unsanitised dump holds, and passes GitHub's SSH address and ordinary package versions", () => {
  const problems = seedProblems("seed.json", JSON.stringify(fixture()));
  for (const kind of ["increment", "question", "wait", "friction", "resteer"]) assert.ok(problems.some((one) => one.includes(` ${kind} record`)), kind);
  assert.ok(problems.some((one) => one.includes(withheld)));
  for (const what of ["an email address", "a user@host", "a Windows home folder", "a Linux home folder", "a tailnet name", "a machine name", "a tailnet address", "the cloud project id", "claude.ai", "Google Drive"]) {
    assert.ok(problems.some((one) => one.includes(what)), what);
  }
  assert.deepEqual(seedProblems("seed.json", JSON.stringify({ text: "clone git@github.com:org/repo with actions/checkout@v6 and pnpm@9.15.0" })), []);
});
