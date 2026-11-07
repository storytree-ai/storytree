import assert from "node:assert/strict";
import { test } from "node:test";

import { heldReading } from "@storytree/arc-surface";

import { encounters as encountersOf, type MapReading } from "./encounters.js";
import { journal } from "./journal.js";

const capability = (id: string, proposed: boolean) => ({ id, proposed });
const tree = (stories: { id: string; capabilities: { id: string; proposed: boolean }[] }[], arcs: { id: string }[] = []) => ({ stories, arcs });
type News = Parameters<typeof heldReading>[0];
/**
 * What the page hands the cards: its held reading, which keeps only what a surface reads (arc surface 3.30), so a card
 * that reads a field or a line the page drops goes red here, not only on the page.
 */
const encounters = (reading: MapReading) => {
  const at = new Date(0).toISOString();
  const held = heldReading({
    changes: reading.changes.map((change, index) => ({ ...change, seq: index + 1,
      record: { id: change.recordId, type: change.type, version: 1, createdAt: at, updatedAt: at, ...change.record } })) as News["changes"],
    lines: reading.lines.map((line, index) => ({ project: "demo", session: "s", source: "tool", at, ...line, seq: index + 1 })) as News["lines"],
  });
  return encountersOf({ ...reading, changes: held.changes, lines: held.lines });
};
const created = (type: string, recordId: string, fields: Record<string, unknown> = {}) => ({ type, recordId, action: "created", record: { fields } });

test("2.1 · the first of each kind on the map is found with what to anchor to, and an empty map once as empty", () => {
  assert.deepEqual(encounters({ tree: tree([]), changes: [], lines: [] }), [{ kind: "empty", target: { kind: "map" } }]);
  const reading: MapReading = {
    tree: tree([
      { id: "story_a", capabilities: [capability("cap_a1", true)] },
      { id: "story_b", capabilities: [capability("cap_b1", true), capability("cap_b2", false)] },
    ], [{ id: "arc_1" }]),
    changes: [
      created("decision", "decision_1"), created("question", "question_x", { lifecycle: "settled" }),
      created("question", "question_1", { lifecycle: "open" }),
    ],
    lines: [{ kind: "claimed", increment: "increment_1" }, { kind: "claimed", capability: "cap_b1" }],
  };
  assert.deepEqual(encounters(reading), [
    { kind: "arc", target: { kind: "arc", arc: "arc_1" } },
    { kind: "story", target: { kind: "story", story: "story_a" } },
    { kind: "capability", target: { kind: "capability", story: "story_a", capability: "cap_a1" } },
    { kind: "claim", target: { kind: "capability", story: "story_b", capability: "cap_b1" } },
    // A colour shows once a capability is built.
    { kind: "health", target: { kind: "capability", story: "story_b", capability: "cap_b2" } },
    { kind: "decision", target: { kind: "note", note: "decision_1" } },
    // Only a question still open waits on the user.
    { kind: "question", target: { kind: "question", question: "question_1" } },
  ]);
  // A retired decision is no longer on the map, nor a claim on a capability the map does not draw.
  assert.deepEqual(encounters({ tree: tree([{ id: "story_a", capabilities: [] }]),
    changes: [created("decision", "decision_1"), { type: "decision", recordId: "decision_1", action: "retired", record: { fields: {} } }],
    lines: [{ kind: "claimed", capability: "cap_gone" }] }), [{ kind: "story", target: { kind: "story", story: "story_a" } }]);
});

/** A stand-in for the page's localStorage. */
function storage() {
  const kept = new Map<string, string>();
  return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
}

test("2.2 · a card fires once per user, on any project, and the journal keeps each in the order seen, across restarts", () => {
  const store = storage();
  let now = "2026-10-15T01:00:00.000Z";
  const first = journal(store, () => now);
  const empty = encounters({ tree: tree([]), changes: [], lines: [] });
  assert.deepEqual(first.unseen(empty).map(found => found.kind), ["empty"]);
  first.mark("empty");
  assert.deepEqual(first.unseen(empty), [], "the empty map is taught once");
  now = "2026-10-15T02:00:00.000Z";
  const grown = encounters({ tree: tree([{ id: "story_a", capabilities: [capability("cap_a1", true)] }]), changes: [], lines: [] });
  assert.deepEqual(first.unseen(grown).map(found => found.kind), ["story", "capability"]);
  first.mark("story");
  // Another project, after a restart: what this user has seen does not fire again, and what never showed still does.
  now = "2026-10-15T03:00:00.000Z";
  const again = journal(store, () => now);
  const other = encounters({ tree: tree([{ id: "story_z", capabilities: [capability("cap_z1", false)] }]), changes: [], lines: [] });
  assert.deepEqual(again.unseen(other).map(found => found.kind), ["capability", "health"]);
  again.mark("capability"); again.mark("story");
  assert.deepEqual(again.seen(), [
    { kind: "empty", at: "2026-10-15T01:00:00.000Z" }, { kind: "story", at: "2026-10-15T02:00:00.000Z" },
    { kind: "capability", at: "2026-10-15T03:00:00.000Z" },
  ]);
  // A kept journal that cannot be read starts again rather than stopping the page.
  const broken = storage();
  broken.setItem("storytree.teaching.seen.v1", "{not json");
  assert.deepEqual(journal(broken).seen(), []);
});

test("2.3 · on a factory the factory is found first, at its switch, then its first role, note and check; a product finds none of them", () => {
  const changes = [
    created("principle", "principle_1"), created("agent", "agent_1"), created("check", "check_1"),
    created("agent", "agent_gone"), { type: "agent", recordId: "agent_gone", action: "retired", record: { fields: {} } },
  ];
  // A factory holds no stories: its map is not "empty", it is the factory.
  assert.deepEqual(encounters({ tree: tree([]), changes, lines: [], factory: true }), [
    { kind: "factory", target: { kind: "switch" } },
    { kind: "role", target: { kind: "note", note: "agent_1" } },
    { kind: "note", target: { kind: "note", note: "principle_1" } },
    { kind: "check", target: { kind: "note", note: "check_1" } },
  ]);
  assert.deepEqual(encounters({ tree: tree([]), changes, lines: [] }), [{ kind: "empty", target: { kind: "map" } }]);
  // The factory card fires on the first switch and never again, on this factory or another.
  const kept = journal(storage());
  const product = encounters({ tree: tree([{ id: "story_a", capabilities: [] }]), changes: [], lines: [] });
  assert.ok(!kept.unseen(product).some(found => found.kind === "factory"), "no factory card on a product");
  const onFactory = encounters({ tree: tree([]), changes: [], lines: [], factory: true });
  assert.deepEqual(kept.unseen(onFactory).map(found => found.kind), ["factory"]);
  kept.mark("factory");
  assert.deepEqual(kept.unseen(onFactory), []);
  assert.deepEqual(kept.unseen(encounters({ tree: tree([]), changes: [], lines: [], factory: true })), [], "switching back and again shows nothing");
});

test("2.4 · a plan whose every piece of work is closed, with no question of its own open, is not found as the plan; the first with work still to do is", () => {
  const increment = (id: string, arc: string, status: string) => created("increment", id, { arc, status });
  const arcs = [{ id: "arc_done" }, { id: "arc_open" }];
  const changes = [increment("increment_1", "arc_done", "proposal"), { ...increment("increment_1", "arc_done", "closed"), action: "updated" },
    increment("increment_2", "arc_open", "proposal")];
  const plan = (changes: MapReading["changes"]) => encounters({ tree: tree([], arcs), changes, lines: [] }).filter(found => found.kind === "arc");
  assert.deepEqual(plan(changes), [{ kind: "arc", target: { kind: "arc", arc: "arc_open" } }], "the finished plan is passed over");
  assert.deepEqual(plan([...changes, { ...increment("increment_2", "arc_open", "closed"), action: "updated" }]), [], "every plan finished: no plan card");
  assert.deepEqual(plan([changes[0]!, changes[1]!, created("question", "question_1", { arc: "arc_done", lifecycle: "open" })]),
    [{ kind: "arc", target: { kind: "arc", arc: "arc_done" } }], "a plan still waiting on the user's answer is not finished");
  assert.deepEqual(plan([]), [{ kind: "arc", target: { kind: "arc", arc: "arc_done" } }], "a plan with no work yet has it all to do");
});

test("2.5 · the tour is asked until the user answers it, and the answer is kept across restarts and told to whoever listens", () => {
  const store = storage();
  const first = journal(store);
  assert.equal(first.tour(), undefined, "not asked yet");
  const heard: string[] = [];
  const stop = first.listen(answer => heard.push(answer));
  first.answer("no");
  assert.equal(journal(store).tour(), "no", "kept after a restart");
  first.answer("yes");
  stop();
  first.answer("no");
  assert.deepEqual(heard, ["no", "yes"], "heard until the listener stops");
  const broken = storage();
  broken.setItem("storytree.teaching.tour.v1", "maybe");
  assert.equal(journal(broken).tour(), undefined, "an answer it cannot read is asked again");
});
