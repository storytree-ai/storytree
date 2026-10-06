/**
 * Capability 9 · Transcripts in the shared log (ADR-0749 D3, D4): what is stored of a session's
 * transcript, scrubbed of obvious secrets, and what is kept once its raw records expire. Records
 * are written to the real activity log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import pg from "pg";

import { ACTIVITY_DATABASE, openActivityLog } from "../activity/index.js";
import { withTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { pruneTranscripts, scrub, shipTranscript, storedContextReading, storedSessionWindow } from "./index.js";

// Fakes built at run time, so no scanner mistakes this file for a leak.
const fake = (...parts: string[]) => parts.join("");

test("9.12 obvious secrets are replaced by a marker naming what was removed, and the record still parses", () => {
  const planted: [string, string, string][] = [
    [fake("sk-", "ant-api03-", "a".repeat(40)), "[scrubbed: API key]", "Anthropic"],
    [fake("sk-", "proj-", "b".repeat(40)), "[scrubbed: API key]", "OpenAI"],
    [fake("ghp", "_", "c".repeat(36)), "[scrubbed: API key]", "GitHub token"],
    [fake("AKIA", "ABCDEFGHIJKLMNOP"), "[scrubbed: API key]", "AWS key id"],
    [fake("AIza", "d".repeat(35)), "[scrubbed: API key]", "Google API key"],
    [fake("ya29", ".", "e".repeat(40)), "[scrubbed: OAuth token]", "Google OAuth token"],
    [fake("Bearer ", "f".repeat(30)), "Bearer [scrubbed: bearer token]", "bearer header"],
    [fake("-----BEGIN RSA PRIVATE KEY-----\nMIIEow", "g".repeat(60), "\n-----END RSA PRIVATE KEY-----"), "[scrubbed: private key]", "private key"],
    [fake("postgres://owner:", "hunter2", "@db.example.com:5432/app"), "postgres://owner:[scrubbed: password]@db.example.com:5432/app", "connection string"],
  ];
  for (const [secret, marker, kind] of planted) {
    const record = JSON.stringify({ type: "user", message: { content: `before ${secret} after` } });
    const scrubbed = scrub(record);
    assert.equal((JSON.parse(scrubbed) as { message: { content: string } }).message.content, `before ${marker} after`, kind);
  }
  const plain = JSON.stringify({ message: { content: "sk-short, a sha 3f2a9c1, https://example.com/a:b@c" } });
  assert.equal(scrub(plain), plain, "ordinary text passes untouched");
});

test("9.13 raw records older than 180 days are deleted by the retention pass, and the reading worked out from them is kept", async () => {
  const project = uniqueProjectName();
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (dir) => {
      const transcript = path.join(dir, "old.jsonl");
      writeFileSync(transcript, `${JSON.stringify({ type: "assistant", requestId: "r1", message: { model: "claude-opus-5-5", usage: { input_tokens: 4_000 } } })}\n`);
      const line = await log.append(project, { session: "old", harness: "claude-code", source: "hook", kind: "session-started", transcript });
      await shipTranscript(log, project, "old", transcript);
      const fresh = path.join(dir, "fresh.jsonl");
      writeFileSync(fresh, `${JSON.stringify({ type: "user", message: { content: "still fresh" } })}\n`);
      await shipTranscript(log, project, "fresh", fresh);
      // The pass runs at the real time over the log every test shares, so the old record is made
      // old rather than the pass run in the future, which would expire other tests' fresh records too.
      await storeAgo(project, "old", 181 * 24 * 60 * 60 * 1000);
      await pruneTranscripts(log);
      assert.equal(await log.transcripts.text(project, "old"), undefined, "its raw records are gone");
      assert.notEqual(await log.transcripts.text(project, "fresh"), undefined, "a record stored within the limit stays");
      const reading = await storedContextReading(log, project, [line], "old");
      assert.equal("tokens" in reading && reading.tokens, 4_000, "its reading remains");
      const window = await storedSessionWindow(log, project, [line], "old");
      assert.equal("absent" in window, false, "and so does its window");
    });
  } finally {
    await log.close();
  }
});

/** Move `session`'s stored records `ms` into the past, as if they had been stored then. */
async function storeAgo(project: string, session: string, ms: number): Promise<void> {
  const url = new URL(testServerUrl());
  url.pathname = `/${ACTIVITY_DATABASE}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query("UPDATE transcript_records SET at = at - $3 * interval '1 millisecond' WHERE project = $1 AND session = $2", [project, session, ms]);
  } finally {
    await client.end();
  }
}
