import assert from "node:assert/strict";
import { test } from "node:test";

import { encounters, type MapReading } from "./encounters.js";
import { journal } from "./journal.js";

const capability = (id: string, proposed: boolean) => ({ id, proposed });
const tree = (stories: { id: string; capabilities: { id: string; proposed: boolean }[] }[], arcs: { id: string }[] = []) => ({ stories, arcs });
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
  assert.deepEqual(first.fresh(empty).map(found => found.kind), ["empty"]);
  assert.deepEqual(first.fresh(empty), [], "the empty map is taught once");
  now = "2026-10-15T02:00:00.000Z";
  const grown = encounters({ tree: tree([{ id: "story_a", capabilities: [capability("cap_a1", true)] }]), changes: [], lines: [] });
  assert.deepEqual(first.fresh(grown).map(found => found.kind), ["story", "capability"]);
  // Another project, after a restart: what this user has seen does not fire again.
  const again = journal(store, () => now);
  const other = encounters({ tree: tree([{ id: "story_z", capabilities: [capability("cap_z1", false)] }]), changes: [], lines: [] });
  assert.deepEqual(again.fresh(other).map(found => found.kind), ["health"]);
  assert.deepEqual(again.seen(), [
    { kind: "empty", at: "2026-10-15T01:00:00.000Z" }, { kind: "story", at: "2026-10-15T02:00:00.000Z" },
    { kind: "capability", at: "2026-10-15T02:00:00.000Z" }, { kind: "health", at: "2026-10-15T02:00:00.000Z" },
  ]);
  // A kept journal that cannot be read starts again rather than stopping the page.
  const broken = storage();
  broken.setItem("storytree.teaching.seen.v1", "{not json");
  assert.deepEqual(journal(broken).seen(), []);
});
