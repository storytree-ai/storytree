/** Running sessions and off-plan rows: the forest's session-to-island reading. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Line, NewLine } from "@storytree/agent-link/readings";
import type { AnnotatedTree, ArcView } from "@storytree/library";
import { sessionRows } from "./sessions-list.js";

const now = new Date("2026-09-28T12:00:00Z");
const health = { reported: { state: "not-checked" }, verified: { state: "not-checked" } } as const;
const tree: AnnotatedTree = { stories: ["one", "two"].map(id => ({ id, title: id, health,
  capabilities: [{ id: `cap-${id}`, title: id, dependsOn: [], contracts: [], health }] })), arcs: [] };
function log(...events: (Partial<Line> & NewLine)[]): Line[] {
  return events.map((event, index) => ({ project: "demo", seq: index + 1, at: now.toISOString(), ...event }));
}
const parent = { session: "parent", harness: "claude-code", source: "tool" } as const;
const child = { session: "child", harness: "codex", source: "hook" } as const;
const off = { session: "off", harness: "codex", source: "hook" } as const;
const claimed = (capability: string, reason: string): NewLine => ({ ...parent, kind: "claimed", capability, reason });
const arc = { arc: { id: "arc", fields: { title: "Build" } }, state: "active",
  increments: [{ id: "inc", fields: { title: "Finish signup", status: "active", touches: ["cap-two"] } }],
  questions: [{ id: "q", fields: { title: "Choose wording", lifecycle: "open" } }] } as ArcView;

test("one row per non-ended session, plain idle, reason and held islands follow standing claims", () => {
  const lines = log(claimed("cap-one", "Build signup"), claimed("cap-two", "Build signup"),
    { ...off, kind: "session-started", at: "2026-09-28T10:00:00Z" },
    { ...child, kind: "session-ended" });
  const rows = sessionRows(tree, lines, [], now);
  assert.deepEqual(rows.map(row => row.id), ["parent", "off"]);
  assert.equal(rows[0]!.label, "Build signup");
  assert.deepEqual(rows[0]!.stories, ["one", "two"]);
  assert.equal(rows[1]!.state, "idle");
  assert.equal(rows[1]!.needsYou, false);
  assert.equal(rows[0]!.totalTokens, undefined, "an unavailable total is not zero");
  lines.push(...log({ ...parent, kind: "released", capability: "cap-one" }).map(line => ({ ...line, seq: 5 })));
  assert.deepEqual(sessionRows(tree, lines, [], now)[0]!.stories, ["two"]);
});

test("explicit children nest once, propagate needs-you and islands; ending a parent promotes its living child", () => {
  const lines = log(claimed("cap-one", "Build signup"),
    { ...parent, kind: "subagent-started", subagent: "child", task: "Finish signup" },
    { ...child, kind: "claimed", increment: "inc", reason: "Finish signup" },
    { ...parent, kind: "subagent-started", subagent: "reader", task: "Read the library" });
  const [row] = sessionRows(tree, lines, [arc], now);
  assert.equal(row!.children.length, 2);
  assert.equal(row!.children[0]!.id, "child");
  assert.equal(row!.children[1]!.label, "Read the library");
  assert.equal(row!.needsYou, true, "a folded child's question remains visible");
  assert.deepEqual(row!.stories, ["one", "two"]);
  const settled = structuredClone(arc);
  settled.questions[0]!.fields.lifecycle = "settled";
  assert.equal(sessionRows(tree, lines, [settled], now)[0]!.needsYou, false);
  lines.push({ ...parent, kind: "session-ended", project: "demo", seq: 5, at: now.toISOString() });
  assert.deepEqual(sessionRows(tree, lines, [arc], now).map(row => row.id), ["child"]);
});

test("off-plan rows retain distinct files and command evidence; claimed edits stay out and islands are never guessed", () => {
  const lines = log({ ...off, kind: "file-edited", files: ["src/a.ts", "src/b.ts"] },
    { ...off, kind: "file-edited", files: ["src/a.ts"] },
    { ...off, kind: "command-run", command: "pnpm test" });
  const [row] = sessionRows(tree, lines, [], now);
  assert.deepEqual(row!.files, ["src/a.ts", "src/b.ts"]);
  assert.equal(row!.offPlan.length, 3);
  assert.equal(row!.offPlan[0]!.command, "pnpm test");
  assert.deepEqual(row!.stories, []);
  lines.push(...log({ ...off, kind: "claimed", capability: "cap-one", reason: "Build" },
    { ...off, kind: "file-edited", files: ["src/claimed.ts"] }).map(line => ({ ...line, seq: line.seq + 3 })));
  assert.deepEqual(sessionRows(tree, lines, [], now)[0]!.files, ["src/a.ts", "src/b.ts"]);
});

test("supplied supervision and totals use a view seam without parsing transcripts; missing parents and cycles keep rows reachable", () => {
  const lines = log(claimed("cap-one", "Build signup"), { ...child, kind: "session-started" });
  const details = new Map([["child", { parentSession: "parent", totalTokens: 120_000 }]]);
  const [row] = sessionRows(tree, lines, [], now, details);
  assert.equal(row!.children[0]!.totalTokens, 120_000);
  details.set("parent", { parentSession: "child", totalTokens: 80_000 });
  const walk = (rows: ReturnType<typeof sessionRows>): string[] => rows.flatMap(row => [row.id, ...walk(row.children)]);
  assert.deepEqual(walk(sessionRows(tree, lines, [], now, details)).sort(), ["child", "parent"]);
});
