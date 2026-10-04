import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { planAt, refreshGrowthSnapshot, type GrowthReading } from "./saved-growth.js";

const t = (minute: number) => `2026-10-01T21:${String(minute).padStart(2, "0")}:00.000Z`;
const passing = { reported: { state: "passing" }, verified: { state: "not-checked" } };
function reading(): GrowthReading {
  let seq = 0;
  const change = (type: string, id: string, at: string, fields: object, action = "created") =>
    ({ seq: ++seq, recordId: id, type, action, record: { id, type, version: seq, fields, createdAt: at, updatedAt: at } });
  const line = (kind: string, at: string, extra = {}) => ({ seq: ++seq, kind, at, project: "conduit", session: "session_one", source: "tool", machine: "PrivateLaptop", folder: "C:\\Users\\alice\\conduit", ...extra });
  const changes = [
    change("story", "story_a", t(1), { title: "Have an account", description: "Sign in" }),
    change("capability", "capability_a1", t(1), { story: "story_a", title: "1 · Sign in", proposed: true }),
    change("contract", "contract_c1", t(2), { capability: "capability_a1", title: "1.1 · Signs in" }),
    change("health", "health_contract_c1_reported", t(2), { node: "contract_c1", column: "reported", state: "failing", note: "Saw it fail at C:\\Users\\alice\\conduit" }),
    change("story", "story_b", t(3), { title: "Read articles" }),
    change("capability", "capability_b1", t(3), { story: "story_b", title: "1 · Article page", proposed: true, dependsOn: ["capability_a1"] }),
    change("capability", "capability_a1", t(4), { story: "story_a", title: "1 · Sign in", proposed: false }, "updated"),
    change("health", "health_contract_c1_reported", t(4), { node: "contract_c1", column: "reported", state: "passing" }, "updated"),
  ];
  const final = { arcs: [], unverified: true as const, stories: [
    { id: "story_a", title: "Have an account", description: "Sign in", health: passing, capabilities: [{ id: "capability_a1", title: "1 · Sign in", description: "", dependsOn: [], proposed: false, status: "untested", reportOnly: true, health: passing, contracts: [{ id: "contract_c1", title: "1.1 · Signs in", description: "", health: passing }] }] },
    { id: "story_b", title: "Read articles", description: "", health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } }, capabilities: [{ id: "capability_b1", title: "1 · Article page", description: "", dependsOn: ["capability_a1"], proposed: true, status: "proposed", health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } }, contracts: [] }] },
  ] };
  return {
    project: "conduit", capturedAt: t(30), window: { from: t(0), to: t(10) },
    tree: final, changes, lines: [line("claimed", t(2), { capability: "capability_a1", increment: "increment_x", reason: "Build sign in" }), line("landed", t(4), { capability: "capability_a1" })],
    stages: [{ id: "building", at: t(2) }, { id: "landed", at: t(5) }],
  } as unknown as GrowthReading;
}

test("3.4 · a stage holds only the stories, capabilities, links, contracts and reported health recorded by its time", () => {
  const { tree, changes } = reading();
  const early = planAt(tree, changes, t(2));
  assert.deepEqual(early.stories.map(story => story.id), ["story_a"]);
  const sign = early.stories[0]!.capabilities[0]!;
  assert.equal(sign.proposed, true);
  assert.equal(sign.status, "proposed");
  assert.equal(sign.contracts[0]!.health.reported.state, "failing");
  assert.equal(sign.health.reported.state, "failing");
  const late = planAt(tree, changes, t(5));
  assert.deepEqual(late.stories.map(story => story.id), ["story_a", "story_b"]);
  assert.deepEqual(late.stories[1]!.capabilities[0]!.dependsOn, ["capability_a1"]);
  assert.equal(late.stories[0]!.capabilities[0]!.status, "untested");
  assert.equal(late.stories[0]!.health.reported.state, "passing");
});

test("3.4 · the saved growth draws each stage at the full plan's places, with the claims live at its time, scrubbed and dated", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "saved-growth-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "conduit.json");
  await refreshGrowthSnapshot(file, async () => reading());
  const text = await readFile(file, "utf8");
  const saved = JSON.parse(text);
  assert.deepEqual(saved.window, { from: t(0), to: t(10) });
  assert.deepEqual(saved.places.map((place: { id: string }) => place.id), ["story_a", "story_b"]);
  assert.deepEqual(saved.stages.map((stage: { id: string; at: string }) => [stage.id, stage.at]), [["building", t(2)], ["landed", t(5)]]);
  const [building, landed] = saved.stages;
  assert.deepEqual(building.scene.islands.map((island: { story: string }) => island.story), ["story_a"]);
  assert.deepEqual(building.wisps.map((wisp: { session: string; story: string; capabilities: string[] }) => [wisp.session, wisp.story, wisp.capabilities]), [["session_one", "story_a", ["capability_a1"]]]);
  assert.equal(building.scene.islands[0].trees[0].form, "seedling");
  assert.deepEqual(landed.wisps, []);
  assert.equal(landed.scene.islands[0].trees[0].form, "green", "landed and reported passing");
  assert.deepEqual(landed.scene.links, [{ from: "capability_b1", to: "capability_a1" }]);
  assert.deepEqual(landed.counts, { stories: 2, capabilities: 2, contracts: 1 });
  assert.doesNotMatch(text, /PrivateLaptop|alice|"(?:folder|machine)"/);
});

test("3.4 · a stage outside the recording's window, or credential-like text, refuses the refresh", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "saved-growth-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "conduit.json");
  const late = reading();
  late.stages = [{ id: "after", at: t(20) }];
  await assert.rejects(refreshGrowthSnapshot(file, async () => late), /window/i);
  const secret = reading();
  secret.tree.stories[0]!.title = "password=hunter2";
  await assert.rejects(refreshGrowthSnapshot(file, async () => secret), /credential/i);
});

test("3.6 · a saved growth keeps the project's notes as dated changes with only their public fields, so its replay grows the core", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "saved-growth-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "growth.json");
  const noted = reading();
  const note = (type: string, id: string, fields: object) => ({ seq: 100 + noted.changes.length, recordId: id, type, action: "created",
    record: { id, type, version: 1, fields, createdAt: t(3), updatedAt: t(3) } });
  noted.changes = [...noted.changes,
    note("decision", "decision_a", { title: "Sign in by cookie", number: 1, status: "accepted", frontCoverOf: "story_a", text: "Seen at C:\\Users\\alice\\conduit" }),
    note("friction", "friction_a", { title: "A private grumble" }),
  ] as GrowthReading["changes"];
  await refreshGrowthSnapshot(file, async () => noted);
  const saved = JSON.parse(await readFile(file, "utf8"));
  const decision = saved.changes.find((change: { recordId: string }) => change.recordId === "decision_a");
  assert.deepEqual(decision.record.fields, { title: "Sign in by cookie", number: 1, status: "accepted", frontCoverOf: "story_a" });
  assert.equal(decision.record.createdAt, t(3));
  assert.ok(saved.changes.some((change: { type: string }) => change.type === "story"), "the stories and capabilities the notes hang on");
  assert.equal(saved.changes.some((change: { type: string }) => change.type === "friction" || change.type === "health"), false);
});
