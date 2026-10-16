/**
 * Capability 9 · Context readings: contract 9.18, what a project's sessions spent, from their transcripts' records
 * stored in the real agent activity log on the Postgres `pnpm test` provides, in the shapes Claude Code and Codex write.
 */
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

import { openActivityLog } from "../activity/index.js";
import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { tokensSpent } from "./index.js";

/** A Claude Code assistant line: one request's usage under its `requestId`. */
function claudeLine(requestId: string, input: number, read: number, output: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant", requestId, isSidechain: false,
    message: { model: "claude-opus-5-5", role: "assistant", usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: output } },
    ...extra,
  });
}

/** A Codex token count carrying its running total. */
function codexLine(last: number, total: number): string {
  return JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: last, output_tokens: 10 }, total_token_usage: { total_tokens: total } } } });
}

const records = (lines: string[], from = 0) => lines.map((record, index) => ({ part: "", start: from + index * 1_000, finish: from + index * 1_000 + 999, record }));

test("9.18 a project's sessions' spend adds every own request's input, cache and output once per request, a subagent's records, and Codex's running total, up to a time or only after one", async () => {
  const log = await openActivityLog(testServerUrl());
  try {
    const project = uniqueProjectName();
    const other = uniqueProjectName();
    const common = { source: "hook", folder: "/work" } as const;
    await log.append(project, { ...common, harness: "claude-code", session: "S", kind: "session-started", transcript: "/work/S.jsonl" });
    await log.append(project, { ...common, harness: "codex", session: "C", kind: "session-started", transcript: "/work/C.jsonl" });

    await log.transcripts.store(project, "S", [
      // One request written across two lines counts once; a sidechain line in the session's own file is a subagent's, not its spend.
      ...records([claudeLine("req_1", 100, 1_000, 40), claudeLine("req_1", 100, 1_000, 40), claudeLine("req_x", 1, 900_000, 1, { isSidechain: true })]),
      { part: "a1", start: 0, finish: 999, record: claudeLine("req_a", 2, 3_000, 8, { isSidechain: true }) },
    ]);
    await log.transcripts.store(project, "C", records([codexLine(400, 5_000)]));
    await log.transcripts.store(other, "S", records([claudeLine("req_o", 7, 7, 7)]));
    await sleep(20);
    const middle = new Date();
    await sleep(20);
    await log.transcripts.store(project, "S", records([claudeLine("req_2", 10, 2_000, 40)], 10_000));
    await log.transcripts.store(project, "C", records([codexLine(900, 9_000)], 10_000));

    assert.equal(await tokensSpent(log, project, { upTo: middle }), 1_140 + 3_010 + 5_000, "by the middle: S's one request, its subagent's and C's running total");
    assert.equal(await tokensSpent(log, project, { after: middle, upTo: new Date() }), 2_050 + 4_000, "after the middle: only what each grew by");
    assert.equal(await tokensSpent(log, project, { upTo: new Date() }), 1_140 + 3_010 + 5_000 + 2_050 + 4_000);
  } finally {
    await log.close();
  }
});
