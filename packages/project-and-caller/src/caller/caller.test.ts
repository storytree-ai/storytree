// Capability 3 · The caller: which session, which of its agents and which harness made a call, from the lines given.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Line } from "@storytree/library";

import { agentOf, harnessOfClient, requestOf, seenCaller, tierOf } from "./index.js";

let seq = 0;
function line(fields: Record<string, unknown>): Line {
  seq += 1;
  return { source: "hook", project: "p", at: new Date(Date.UTC(2026, 9, 14, 0, 0, seq)).toISOString(), seq, ...fields } as Line;
}
const requested = (fields: Record<string, unknown>) => line({ kind: "tool-requested", tool: "open", ...fields });

test("3.1 · a call carrying its id is named by the hook line left under that id: its session and agent, a subagent's type and task filled from its start line", () => {
  const started = line({ kind: "subagent-started", session: "s-new", harness: "claude-code", subagent: "a1", type: "explorer", task: "sweep" });
  const other = requested({ session: "s-other", harness: "claude-code", call: "toolu_other", agent: "orchestrator" });
  const mine = requested({ session: "s-new", harness: "claude-code", call: "toolu_1", agent: { subagent: "a1" } });
  const lines = [started, other, mine];
  const claudeMeta = { "claudecode/toolUseId": "toolu_1" };

  assert.equal(requestOf(lines, claudeMeta), mine);
  assert.deepEqual(agentOf(lines, claudeMeta), { subagent: "a1", type: "explorer", task: "sweep" });
  // After /clear the server keeps the id it started with; the hook's line names the window's new session.
  assert.deepEqual(seenCaller(lines, { session: "s-old", harness: "claude-code" }, claudeMeta), { session: "s-new", harness: "claude-code" });

  const codex = requested({ session: "c1", harness: "codex", call: "call_9", agent: "orchestrator" });
  const codexMeta = { callId: "call_9", threadId: "t-sub", sessionId: "c1" };
  assert.equal(agentOf([codex], codexMeta), "orchestrator", "the hook's line, not the thread, names the agent");
  assert.deepEqual(seenCaller([codex], { session: "c0", harness: "codex" }, codexMeta), { session: "c1", harness: "codex" });

  assert.deepEqual(seenCaller(lines, { session: "s-old", harness: "claude-code" }, { "claudecode/toolUseId": "toolu_none" }), { session: "s-old", harness: "claude-code" });
  assert.equal(requestOf(lines, { "claudecode/toolUseId": "toolu_none" }), undefined);
});

test("3.2 · with no hook line, a Codex call on its session's thread is the orchestrator's, any other thread a subagent's own, and a call with neither is unknown", () => {
  assert.equal(agentOf([], { callId: "call_1", threadId: "c1", sessionId: "c1" }), "orchestrator");
  assert.deepEqual(agentOf([], { callId: "call_1", threadId: "t-2", sessionId: "c1" }), { subagent: "t-2" });
  const started = line({ kind: "subagent-started", session: "c1", harness: "codex", subagent: "t-2", type: "worker" });
  assert.deepEqual(agentOf([started], { threadId: "t-2", sessionId: "c1" }), { subagent: "t-2", type: "worker" });
  assert.equal(agentOf([], {}), "unknown");
  assert.equal(agentOf([], { threadId: "t-2" }), "unknown", "a thread with no session names no agent");
  // A hook line from an earlier call, nearer in time, is never taken for this one.
  const earlier = requested({ session: "s", harness: "claude-code", call: "toolu_0", agent: "orchestrator" });
  assert.equal(agentOf([earlier], { "claudecode/toolUseId": "toolu_1" }), "unknown");
});

test("3.3 · a call with no id from a harness whose calls carry none is named by the newest tool-requested line that harness left; one whose calls carry ids never is", () => {
  for (const harness of ["cursor", "pi", "antigravity"]) {
    const older = requested({ session: `${harness}-old`, harness, call: "x1", agent: "orchestrator" });
    const newer = requested({ session: `${harness}-new`, harness, call: "x2", agent: "orchestrator" });
    assert.equal(requestOf([older, newer], {}), newer, harness);
    assert.deepEqual(seenCaller([older, newer], { session: "server", harness }, {}), { session: `${harness}-new`, harness });
  }
  for (const harness of ["claude-code", "codex"]) {
    const line = requested({ session: "s", harness, call: "x3", agent: "orchestrator" });
    assert.equal(requestOf([line], {}), undefined, harness);
    assert.deepEqual(seenCaller([line], { session: "server", harness }, {}), { session: "server", harness });
  }
});

test("3.4 · an MCP client's name gives its watched harness's id and any other client its own name; a watched harness's session is watched, any other connected", () => {
  assert.equal(harnessOfClient("codex-mcp-client"), "codex");
  assert.equal(harnessOfClient("claude-code"), "claude-code");
  assert.equal(harnessOfClient("Cursor"), "cursor");
  assert.equal(harnessOfClient("antigravity-client"), "antigravity");
  assert.equal(harnessOfClient("some-editor"), "some-editor");
  assert.equal(harnessOfClient(undefined), undefined);
  for (const harness of ["claude-code", "codex", "cursor", "pi", "antigravity"]) assert.equal(tierOf(harness), "watched", harness);
  assert.equal(tierOf("some-editor"), "connected");
  assert.equal(tierOf(undefined), "connected");
});
