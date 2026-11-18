// Capability 3 · Hooks
import assert from "node:assert/strict";
import { test } from "node:test";

import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { openActivityLog } from "../activity/index.js";
import { hookLines } from "./hooks.js";
import { outsideTextReads } from "./outside-text.js";

const base = { session_id: "s-1", cwd: "/work", hook_event_name: "PostToolUse", tool_use_id: "call-1" };

function made(harness: string, tool: string, input: Record<string, unknown>): [string, string | undefined][] {
  return (hookLines(harness, { ...base, tool_name: tool, tool_input: input })?.lines ?? []).map((line) => [line.kind, (line as { what?: string }).what]);
}

test("3.49 a hook records each read of outside text: a fetched page, a web search, a GitHub or Gmail tool, or a command reading an issue, pull request or web page", () => {
  assert.deepEqual(made("claude-code", "WebFetch", { url: "https://example.com/post", prompt: "Summarise" }), [["outside-text-read", "WebFetch https://example.com/post"]]);
  assert.deepEqual(made("claude-code", "WebSearch", { query: "storytree memory poisoning" }), [["outside-text-read", "WebSearch storytree memory poisoning"]]);
  assert.deepEqual(made("claude-code", "mcp__github__get_issue", { owner: "o", repo: "r", issue_number: 3 }), [["outside-text-read", "mcp__github__get_issue"]]);
  assert.deepEqual(made("claude-code", "mcp__claude_ai_Gmail__read_thread", { id: "t" }), [["outside-text-read", "mcp__claude_ai_Gmail__read_thread"]]);
  for (const command of ["gh pr view 12 --comments", "gh issue view 7", "gh pr diff 12", "gh api repos/o/r/issues/7/comments", "curl -s https://example.com/x | jq .", "wget https://example.com/a"]) {
    assert.deepEqual(made("claude-code", "Bash", { command }), [["command-run", undefined], ["outside-text-read", command]], `Claude Code: ${command}`);
    assert.deepEqual(made("codex", "Bash", { command }), [["command-run", undefined], ["outside-text-read", command]], `Codex: ${command}`);
  }

  for (const command of ["gh pr create --title x", "gh pr checks 12", "git log", "curl http://localhost:5432/health", "pnpm test"]) {
    assert.deepEqual(made("claude-code", "Bash", { command }), [["command-run", undefined]], `not a read: ${command}`);
  }
  assert.deepEqual(made("claude-code", "Read", { file_path: "/work/a.ts" }), []);
  assert.deepEqual(made("claude-code", "mcp__storytree__open", { id: "x" }), []);

  const long = `curl https://example.com/${"a".repeat(1000)}`;
  assert.equal(made("claude-code", "Bash", { command: long })[1]![1]!.length, 300, "what was read is cut to a line's length");
});

test("3.49 what a session read from outside is read back for its writes: each read once, its own session's only, newest twenty", async () => {
  const project = uniqueProjectName();
  const log = await openActivityLog(testServerUrl());
  try {
    const read = (session: string, what: string) => log.append(project, { session, source: "hook", kind: "outside-text-read", what });
    assert.deepEqual(await outsideTextReads(log, project, "lane"), [], "a session that read nothing outside");
    await read("lane", "gh pr view 12");
    await read("lane", "WebFetch https://example.com/post");
    await read("lane", "gh pr view 12");
    await read("other", "gh issue view 7");
    assert.deepEqual((await outsideTextReads(log, project, "lane")).sort(), ["WebFetch https://example.com/post", "gh pr view 12"]);
    for (let n = 0; n < 25; n += 1) await read("busy", `gh issue view ${n}`);
    const busy = await outsideTextReads(log, project, "busy");
    assert.equal(busy.length, 20);
    assert.ok(busy.includes("gh issue view 24") && !busy.includes("gh issue view 0"), "the newest kept");
  } finally {
    await log.close();
    await dropTestProjects([project]);
  }
});
