import assert from "node:assert/strict";
import { test } from "node:test";
import type { Line, NewLine } from "@storytree/agent-link";
import { agentsOnBoard } from "./agents.js";

const start = Date.parse("2026-09-27T00:00:00Z");
const at = (minute: number) => new Date(start + minute * 60_000);
const lines: Line[] = [
  { kind: "session-started", source: "hook", harness: "claude-code", session: "s1", seq: 1, at: at(0).toISOString(), project: "p" },
  { kind: "claimed", source: "tool", harness: "claude-code", session: "s1", increment: "i", reason: "finish the board", seq: 2, at: at(1).toISOString(), project: "p" },
  { kind: "session-started", source: "hook", harness: "claude-code", session: "s2", seq: 3, at: at(2).toISOString(), project: "p" },
  { kind: "claimed", source: "tool", harness: "claude-code", session: "s2", capability: "part", reason: "draw it", seq: 4, at: at(3).toISOString(), project: "p" },
  { kind: "claimed", source: "tool", harness: "codex", session: "s3", capability: "elsewhere", reason: "other work", seq: 5, at: at(4).toISOString(), project: "p" },
];

test("2.4 an arc's holders come only from its open increments: their own claims and capability claims taken under them (ADR-0949 D1)", () => {
  const under = (seq: number, session: string, capability: string, increment?: string): Line => ({ kind: "claimed", source: "tool", harness: "claude-code", session, capability, ...(increment ? { under: increment } : {}), reason: "build", seq, at: at(seq).toISOString(), project: "p" });
  const board = agentsOnBoard([...lines, under(6, "s1", "mine", "i"), under(7, "s4", "shared", "other-arc-work")], at(8));
  const open = { id: "i", fields: { status: "active" as const, capabilities: ["shared"] } };
  assert.deepEqual(board.onArc([open]).map((agent) => agent.capability ?? agent.increment), ["i", "mine"], "a capability counts toward the increment it was taken under, not toward a list naming it");
  // The 2026-10-09 case: a landed increment lists a capability another arc's session holds.
  const landed = { id: "done", fields: { status: "closed" as const, capabilities: ["shared", "part"] } };
  assert.deepEqual(board.onArc([landed]), [], "a closed increment contributes nothing");
  assert.deepEqual(agentsOnBoard([...lines, under(6, "s1", "mine", "done")], at(8)).onArc([landed]), [], "not even a claim taken under it");
});

test("2.1–2.4 the board names each window, reason, quiet age and missing hooks, only on the work its arc names", () => {
  const board = agentsOnBoard(lines, at(5));
  assert.equal(board.on("i")?.label, "Claude Code");
  assert.equal(board.on("i")?.startedAt, at(0).toISOString());
  assert.equal(board.on("part")?.startedAt, at(2).toISOString());
  assert.equal(board.on("i")?.reason, "finish the board");
  assert.equal(board.on("i")?.activity, "live");
  assert.equal(board.on("elsewhere")?.label, "Codex");
  assert.equal(board.on("elsewhere")?.activity, "hooks not running");
  assert.deepEqual(board.onArc([{ id: "i", fields: { status: "active", capabilities: ["part"] } }]).map((agent) => agent.session), ["s1"]);
  assert.deepEqual(board.onArc([]), []);
  const idle = agentsOnBoard(lines, at(42)).on("i")!;
  assert.equal(idle.holder, "idle");
  assert.equal(idle.activity, "idle for 41 min");
  assert.equal(idle.quietMinutes, 41);
});

test("2.2 every claim-ending event removes the holder, and a running command follows the agent link's live reading", () => {
  const endings: NewLine[] = [
    { kind: "released", source: "tool", session: "s1", increment: "i" },
    { kind: "closed", source: "tool", session: "s1", increment: "i", disposition: "landed" },
    { kind: "session-ended", source: "hook", session: "s1" },
    { kind: "merged", source: "tool", session: "observer", holder: "s1", increment: "i", branch: "build", pr: 42 },
  ];
  for (const end of endings) {
    assert.equal(agentsOnBoard([...lines, { ...end, seq: 6, at: at(6).toISOString(), project: "p" }], at(42)).on("i"), undefined, end.kind);
  }
  assert.equal(agentsOnBoard([...lines, { kind: "landed", source: "tool", session: "s2", capability: "part", seq: 6, at: at(6).toISOString(), project: "p" }], at(42)).on("part"), undefined);
  assert.equal(agentsOnBoard([...lines, { kind: "command-started", source: "hook", session: "s1", command: "tests", call: "c", seq: 6, at: at(6).toISOString(), project: "p" }], at(90)).on("i")?.activity, "live");
});
