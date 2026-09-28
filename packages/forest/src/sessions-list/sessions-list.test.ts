/** Running sessions: the forest's session-to-island reading. */
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

test("one row per non-ended claiming session, plain idle, reason and held islands follow standing claims", () => {
  const lines = log(claimed("cap-one", "Build signup"), claimed("cap-two", "Build signup"),
    { ...off, kind: "claimed", increment: "tidy", reason: "", at: "2026-09-28T10:00:00Z" },
    { ...child, kind: "session-ended" },
    { session: "quiet", harness: "codex", source: "hook", kind: "session-started" });
  const rows = sessionRows(tree, lines, [], now);
  assert.deepEqual(rows.map(row => row.id), ["parent", "off"], "a session holding no claim gets no row");
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
  const [row] = sessionRows(tree, lines, [arc], now, new Map([["reader", { totalTokens: 123 }]]));
  assert.equal(row!.children.length, 2);
  assert.equal(row!.children[0]!.id, "child");
  assert.equal(row!.children[1]!.label, "Read the library");
  assert.equal(row!.children[1]!.totalTokens, 123, "observed subagents use the supplied reading too");
  assert.equal(row!.needsYou, true, "a folded child's question remains visible");
  assert.deepEqual(row!.stories, ["one", "two"]);
  const settled = structuredClone(arc);
  settled.questions[0]!.fields.lifecycle = "settled";
  assert.equal(sessionRows(tree, lines, [settled], now)[0]!.needsYou, false);
  lines.push({ ...parent, kind: "session-ended", project: "demo", seq: 5, at: now.toISOString() });
  assert.deepEqual(sessionRows(tree, lines, [arc], now).map(row => row.id), ["child"]);
});

test("7.1 a session holding no claim gets no row however much unclaimed work it has done (ADR-0737 D1)", () => {
  const lines = log({ ...off, kind: "file-edited", files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"] },
    { ...off, kind: "command-run", command: "git push -u origin fix" }, { ...off, kind: "command-run", command: "gh pr create --fill" });
  assert.deepEqual(sessionRows(tree, lines, [], now), []);
});

test("supplied supervision and totals use a view seam without parsing transcripts; missing parents and cycles keep rows reachable", () => {
  const lines = log(claimed("cap-one", "Build signup"), { ...child, kind: "claimed", increment: "inc", reason: "Finish signup" });
  const details = new Map([["child", { parentSession: "parent", totalTokens: 120_000 }]]);
  const [row] = sessionRows(tree, lines, [], now, details);
  assert.equal(row!.children[0]!.totalTokens, 120_000);
  details.set("parent", { parentSession: "child", totalTokens: 80_000 });
  const walk = (rows: ReturnType<typeof sessionRows>): string[] => rows.flatMap(row => [row.id, ...walk(row.children)]);
  assert.deepEqual(walk(sessionRows(tree, lines, [], now, details)).sort(), ["child", "parent"]);
});
