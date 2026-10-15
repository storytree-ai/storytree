/**
 * Capability 6 · Agent tools (the MCP server). A harness hands the tool server a hook event (ADR-1056 D2): its tool is
 * mounted from Session management's manifest and records the event through the server's own connection, as a
 * harness's call rather than an agent's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { habitsCard } from "../instructions/habits.js";
import { claudeCode, withAgent } from "../testing/agent.js";
import { withProject } from "../testing/tool-world.js";

test("6.79 the tool server takes a hook event from a harness through its hook_event tool, mounted from Session management's manifest, and records it through its own connection with no tool-called or door-answered line; the habits card does not name it", async () => {
  await withProject(async ({ folder, project, log }) => {
    const input = {
      session_id: `${project}-hooked`, cwd: folder, hook_event_name: "PostToolUse", tool_name: "Bash",
      tool_input: { command: "echo probe-command" }, tool_response: { stdout: "probe-command", stderr: "", interrupted: false }, tool_use_id: "toolu_1",
    };
    await withAgent(folder, claudeCode(`${project}-server`), async (agent) => {
      assert.ok((await agent.tools()).includes("hook_event"), "a harness finds it listed");
      const answer = await agent.call("hook_event", { harness: "claude-code", input });
      assert.equal(answer.isError, false, answer.text);
      assert.deepEqual([answer.data.recorded, answer.data.waiting], [1, 0]);
    });
    const lines = (await log.since(project, 0)).lines;
    assert.deepEqual(lines.map((line) => [line.session, line.kind]), [[`${project}-hooked`, "command-run"]], "the event's line on its own session, and no line of the call");
    assert.ok(!habitsCard().includes("hook_event"), "the card teaches the model nothing of it");
  });
});
