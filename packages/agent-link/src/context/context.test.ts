/**
 * Capability 9 · Context readings: one test per contract 9.1-9.3, 9.5 and 9.6 in the agent link
 * story. The transcripts are written line by line in the shapes Claude Code 2.1.283 and Codex 0.155
 * write them (a Claude Code assistant line's `message.usage` under its `requestId`; a Codex
 * `event_msg` of type `token_count`); the lines naming each session's transcript go to the real
 * agent activity log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { MARKER_FILE } from "../routing/index.js";
import { withTempDir } from "../testing/folders.js";
import { testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { claudeCodeTokens, codexTokens, contextCommand, readContext } from "./index.js";

/** One Claude Code assistant line: a request's usage, as the harness records it. */
function claudeLine(requestId: string, usage: { input: number; read: number; created: number }, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    requestId,
    isSidechain: false,
    timestamp: "2026-09-28T01:00:00.000Z",
    message: {
      model: "claude-opus-5-5",
      role: "assistant",
      usage: { input_tokens: usage.input, cache_read_input_tokens: usage.read, cache_creation_input_tokens: usage.created, output_tokens: 40 },
    },
    ...extra,
  });
}

/** One Codex token count, as its rollout records it. */
function codexLine(input: number): string {
  return JSON.stringify({
    type: "event_msg",
    payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, cached_input_tokens: Math.floor(input / 2), output_tokens: 42 }, model_context_window: 258_400 } },
  });
}

const jsonl = (...lines: string[]): string => `${lines.join("\n")}\n`;

test("9.1 a Claude Code transcript reads the session's own latest request: input + cache-read + cache-creation, one count per requestId, and a later subagent or synthetic line does not change it", () => {
  const text = jsonl(
    JSON.stringify({ type: "user", message: { role: "user", content: "go" } }),
    claudeLine("req_1", { input: 10, read: 1_000, created: 200 }),
    claudeLine("req_2", { input: 12_000, read: 300_000, created: 5_000 }),
    // One request, written across several lines (one per content block): counted once.
    claudeLine("req_2", { input: 12_000, read: 300_000, created: 5_000 }),
    claudeLine("req_3", { input: 1, read: 900_000, created: 0 }, { isSidechain: true }),
    JSON.stringify({ type: "assistant", message: { model: "<synthetic>", role: "assistant", usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
  );
  assert.deepEqual(claudeCodeTokens(text), { tokens: 317_000 });
});

test("9.2 a transcript that is empty, unreadable, or holds only subagent or synthetic requests reads as an absence naming which, never as 0 tokens", () => {
  assert.deepEqual(claudeCodeTokens(""), { absent: "the transcript is empty" });
  assert.deepEqual(claudeCodeTokens("{ not json\n[1, 2\n"), { absent: "the transcript holds no line storytree can read" });
  assert.deepEqual(
    claudeCodeTokens(jsonl(claudeLine("req_1", { input: 5, read: 5, created: 5 }, { isSidechain: true }), claudeLine("req_2", { input: 0, read: 0, created: 0 }, { message: { model: "<synthetic>", usage: { input_tokens: 0 } } }))),
    { absent: "the transcript holds only subagent or synthetic requests" },
  );
  assert.deepEqual(codexTokens(jsonl(JSON.stringify({ type: "session_meta", payload: { id: "t" } }))), { absent: "the rollout holds no token count" });
});

test("9.3 a Codex rollout reads its last token count's input tokens as tokens used", () => {
  const text = jsonl(JSON.stringify({ type: "session_meta", payload: { id: "thread-1" } }), codexLine(12_348), JSON.stringify({ type: "response_item", payload: {} }), codexLine(40_210));
  assert.deepEqual(codexTokens(text), { tokens: 40_210 });
});

/** Run `body` with the log open on the test server, a fresh project to write in, and a throwaway folder. */
async function withProject(body: (log: ActivityLog, project: string, dir: string) => Promise<void>): Promise<void> {
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir((dir) => body(log, uniqueProjectName(), dir));
  } finally {
    await log.close();
  }
}

test("9.5 a session's reading is worked out when asked, from the transcript last recorded for it, read at that moment; another session's transcript is never read, and one with no transcript recorded is an absence", async () => {
  await withProject(async (log, project, dir) => {
    const mine = path.join(dir, "mine.jsonl");
    const theirs = path.join(dir, "theirs.jsonl");
    writeFileSync(mine, jsonl(claudeLine("req_1", { input: 100, read: 1_000, created: 0 })));
    writeFileSync(theirs, jsonl(claudeLine("req_9", { input: 1, read: 800_000, created: 0 })));
    const common = { harness: "claude-code", source: "hook", folder: dir } as const;
    await log.append(project, { ...common, session: "S", kind: "session-started", transcript: mine });
    await log.append(project, { ...common, session: "T", kind: "session-started", transcript: theirs });

    const first = await readContext(log, project, "S", { now: new Date("2026-09-28T02:00:00.000Z") });
    assert.deepEqual(first, { session: "S", harness: "claude-code", tokens: 1_100,
      // No record before its one request: all 1,100 tokens are the system prompt and tool list (9.8).
      composition: { injected: 1_100, grounding: 0, implementation: 0, other: 0, unsorted: [], charsPerToken: 3.8 },
      at: "2026-09-28T02:00:00.000Z", source: mine });

    // The transcript grew with no turn ended and no hook fired: the next ask sees it.
    appendFileSync(mine, jsonl(claudeLine("req_2", { input: 200, read: 50_000, created: 800 })));
    const grown = await readContext(log, project, "S");
    assert.equal("tokens" in grown && grown.tokens, 51_000);

    // Nothing recorded for a session: an absence, and no other session's transcript stands in.
    const none = await readContext(log, project, "U", { now: new Date("2026-09-28T02:00:00.000Z") });
    assert.deepEqual(none, { session: "U", absent: "no hook has named this session's transcript", at: "2026-09-28T02:00:00.000Z" });
  });
});

test("9.6 `storytree context` prints this session's tokens used, worked out at that moment, and --json the record; it exits 0 whatever the figure, and with no reading it says so and prints no number", async () => {
  await withProject(async (log, project, dir) => {
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    const transcript = path.join(dir, "S.jsonl");
    writeFileSync(transcript, jsonl(claudeLine("req_1", { input: 2_000, read: 480_000, created: 12_345 })));
    await log.append(project, { session: "S", harness: "claude-code", source: "hook", folder, kind: "session-started", transcript });
    const locate = { dataDir: testServerDataDir() };

    const plain = await contextCommand({ folder, env: { CLAUDE_CODE_SESSION_ID: "S" }, locate });
    assert.equal(plain.code, 0);
    assert.match(plain.text, /494,345 tokens/);
    assert.doesNotMatch(plain.text, /%/);

    const json = await contextCommand({ folder, env: { CLAUDE_CODE_SESSION_ID: "S" }, json: true, locate });
    assert.equal(json.code, 0);
    assert.deepEqual({ ...JSON.parse(json.text), at: "-" }, { session: "S", harness: "claude-code", tokens: 494_345,
      composition: { injected: 494_345, grounding: 0, implementation: 0, other: 0, unsorted: [], charsPerToken: 3.8 }, at: "-", source: transcript });

    const nothing = await contextCommand({ folder, env: { CLAUDE_CODE_SESSION_ID: "nobody" }, locate });
    assert.equal(nothing.code, 0);
    assert.doesNotMatch(nothing.text, /\d/);
    assert.match(nothing.text, /no hook has named this session's transcript/);

    const noSession = await contextCommand({ folder, env: {}, locate });
    assert.equal(noSession.code, 0);
    assert.doesNotMatch(noSession.text, /\d/);
  });
});
