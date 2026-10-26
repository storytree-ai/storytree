import assert from "node:assert/strict";
import { test } from "node:test";

import { WITHHELD_ARCS, captureProblems, captureText, machinesNamed, sanitiseSeed, scrubCapture, seedProblems } from "./evidence-seed.js";

const withheld = WITHHELD_ARCS[0]!;
// The test's own machines stand in for the owner's, and the links and addresses are joined at run time, so this file holds none.
const machines = machinesNamed({ "box-one-two": "<mint-box>", "lapone": "<laptop>", "testlap": "<test-laptop>", "oldlap": "<test-laptop>" });
const join = (...parts: string[]) => parts.join("");
const claude = join("https://claude", ".ai/");
const leaks = [
  "owner@example.com", "someone@box-one-two", "C:\\Users\\someone\\code", "/home/someone/code", "box.tail0000.ts.net",
  "LapOne", "testlap", "oldlap", ["100", "97", "8", "31"].join("."), join("storytree", "-", "498613"), join("ci%40storytree", "-", "498613", ".iam"),
  `${claude}artifact/AbC123`, `${claude}code/session_1`, `${claude}share/xyz`,
  join("https://docs", ".google.com/document/d/1"), join("https://drive", ".google.com/file/d/2"),
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
    lines: { lines: [{ text: "a session ran on testlap" }], cursor: 3 },
    covers: { story_a: [records[4], records[7], records[8]] },
  };
}

test("3.69 · a dump passed through the seed sanitiser keeps stories, capabilities, contracts, health and knowledge, reduces arcs to id, title and stories, and drops work records, the withheld arc and every record naming it, and every redaction pattern", () => {
  const raw = fixture();
  const clean = sanitiseSeed(raw, WITHHELD_ARCS, machines);
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
  assert.deepEqual(seedProblems("seed.json", text, WITHHELD_ARCS, machines), []);
  assert.deepEqual(raw.changes.changes.length, 13, "the dump it read is left as it was");
});

test("3.69 · the seed check names each work record kind, the withheld arc and each redaction pattern an unsanitised dump holds, and passes GitHub's SSH address and ordinary package versions", () => {
  const problems = seedProblems("seed.json", JSON.stringify(fixture()), WITHHELD_ARCS, machines);
  for (const kind of ["increment", "question", "wait", "friction", "resteer"]) assert.ok(problems.some((one) => one.includes(` ${kind} record`)), kind);
  assert.ok(problems.some((one) => one.includes(withheld)));
  for (const what of ["an email address", "a user@host", "a Windows home folder", "a Linux home folder", "a tailnet name", "a machine name", "a tailnet address", "the cloud project id", "claude.ai", "Google Drive"]) {
    assert.ok(problems.some((one) => one.includes(what)), what);
  }
  assert.deepEqual(seedProblems("seed.json", JSON.stringify({ text: "clone git@github.com:org/repo with actions/checkout@v6 and pnpm@9.15.0" })), []);
});

test("3.70 · a capture passed through the capture scrubber keeps what the run did, reads UTF-16 as text, and loses home folders, machine names (named by role), session ids, synced plugin paths, claude.ai connectors and links, so the capture check finds nothing", () => {
  const init = {
    type: "system", subtype: "init", cwd: "C:\\Users\\someone\\project", session_id: "4281-8267",
    mcp_servers: [{ name: "storytree", status: "connected" }, { name: "claude.ai Gmail", status: "connected" }],
    plugins: [{ name: "cowork", path: "C:\\Users\\someone\\.claude\\plugins\\synced\\38dc_fed2\\cowork~g2" }],
  };
  const raw = [
    JSON.stringify(init),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `built it on testlap, see ${claude}chat/abc` }] }, session_id: "4281-8267" }),
    "model: claude-opus-5-5 | mcp: storytree=connected,claude.ai Gmail=connected",
    "claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - √ Connected",
    "storytree: /home/someone/tools/storytree-mcp.mjs - √ Connected",
    "ran on box-one-two, not over-box-one-two-ish",
    "",
  ].join("\n");
  const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...raw].map((c) => c.charCodeAt(0))).buffer)]);
  assert.ok(captureProblems("turn-1.jsonl", utf16, machines).some((problem) => /turn-1\.jsonl is UTF-16/.test(problem)));
  const text = captureText(utf16);
  assert.equal(text, raw);
  assert.equal(captureText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(raw)])), raw);
  const before = captureProblems("turn-1.jsonl", new TextEncoder().encode(raw), machines).join("\n");
  for (const what of ["a connector line", "a connector in a status line", "a session id", "a synced plugin path", "a claude.ai link", "a Windows home folder", "a Linux home folder", "a machine name"]) {
    assert.ok(before.includes(what), `${what} is found before scrubbing:\n${before}`);
  }

  const clean = scrubCapture(text, machines);
  assert.deepEqual(captureProblems("turn-1.jsonl", new TextEncoder().encode(clean), machines), []);
  const lines = clean.split("\n");
  const first = JSON.parse(lines[0]!);
  assert.equal(first.subtype, "init");
  assert.equal(first.cwd, "<home>\\project");
  assert.equal(first.session_id, undefined);
  assert.deepEqual(first.mcp_servers, [{ name: "storytree", status: "connected" }]);
  assert.equal(first.plugins[0].name, "cowork");
  assert.equal(JSON.parse(lines[1]!).message.content[0].text, "built it on <test-laptop>, see <claude-link>");
  assert.deepEqual(lines.slice(2), ["model: claude-opus-5-5 | mcp: storytree=connected", "storytree: <home>/tools/storytree-mcp.mjs - √ Connected", "ran on <mint-box>, not over-<mint-box>-ish", ""]);

  const profile = JSON.stringify({ nodes: [{ callFrame: { url: "file:///home/someone/code/a.js", functionName: "f" } }] });
  assert.equal(JSON.parse(scrubCapture(profile, machines)).nodes[0].callFrame.url, "file://<home>/code/a.js");
});

test("3.69 · the seed sanitiser names each writer by role (owner or agent), drops a harness's session id from who verified a health record, and withholds the published-copies arc and every record naming it, so the seed check that refused the dump passes it", () => {
  const arc = "arc_824a506f2125";
  const records = [
    { ...record("story_a", "story", { title: "The library" }), scribedBy: "someone" },
    { ...record("decision_a", "decision", { text: "kept" }), scribedBy: "session 6f01ff85" },
    { ...record("health_a", "health", { node: "contract_a", state: "passing", by: "claude-code b5609ede-db65-4041-b81a-68ea0c2d1e3f" }), scribedBy: "agent" },
    { ...record("health_b", "health", { node: "contract_a", state: "passing", by: "the project's CI" }), scribedBy: "owner" },
    record(arc, "arc", { title: "Withheld too", stories: ["story_a"] }),
    record("decision_b", "decision", { text: `names ${arc}` }),
  ];
  const raw = { tree: { stories: [{ id: "story_a", title: "The library" }], arcs: [{ id: arc, title: "Withheld too", stories: [] }] }, changes: { changes: records.map((one, at) => change(at + 1, one)), cursor: records.length } };
  const problems = seedProblems("seed.json", JSON.stringify(raw)).join("\n");
  assert.match(problems, /names a writer other than by role in scribedBy/);
  assert.ok(!problems.includes("someone"), "the check never repeats the name it refuses");
  assert.match(problems, /names a session in by/);
  assert.match(problems, new RegExp(`names a withheld arc \\(${arc}\\)`));

  const clean = sanitiseSeed(raw);
  assert.deepEqual(clean.changes.changes.map((one) => [one.record.id, (one.record as { scribedBy?: string }).scribedBy, one.record.fields.by]), [
    ["story_a", "owner", undefined], ["decision_a", "agent", undefined], ["health_a", "agent", "agent"], ["health_b", "owner", "the project's CI"],
  ]);
  assert.deepEqual(clean.tree, { stories: [{ id: "story_a", title: "The library" }], arcs: [] });
  assert.deepEqual(seedProblems("seed.json", JSON.stringify(clean)), []);
});
