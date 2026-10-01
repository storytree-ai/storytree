/**
 * Capability 3 · Surfaces: the page's reads, contracts 3.1 and 3.2 in the app story, against the
 * real Postgres `pnpm test` provides. Each test works in projects named t- and 8 hex digits, so
 * tests sharing the server never read each other's, and drops their libraries afterwards.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openActivityLog, shipTranscript, type ActivityLog } from "@storytree/agent-link";
import { connect, type Storytree } from "@storytree/library";
import pg from "pg";

import { pageReads, type PageReads } from "../index.js";

test("3.1 the page can ask the app for the library's changes and the agent log's new lines since a point, for the project on show, and only newer ones come back", async () => {
  const shown = uniqueProjectName();
  const other = uniqueProjectName();
  await withApp([shown, other], async ({ storytree, log, reads }) => {
    // An agent's work, written as the agent link writes it: into the project's library and the log.
    const library = await storytree.openProject(shown);
    const first = await library.addStory({ title: "Visitor can sign up" });
    await log.append(shown, { session: "A", source: "hook", kind: "session-started" });
    await (await storytree.openProject(other)).addStory({ title: "Another project's story" });
    await log.append(other, { session: "B", source: "hook", kind: "session-started" });

    const changes = await reads.changesSince(shown, 0);
    assert.deepEqual(changes.changes.map(({ recordId }) => recordId), [first.id], "the project on show's changes, and no other project's");
    const lines = await reads.linesSince(shown, 0);
    assert.deepEqual(lines.lines.map(({ session, kind }) => [session, kind]), [["A", "session-started"]], "its lines, and no other project's");

    const second = await library.addStory({ title: "Visitor can sign in" });
    await log.append(shown, { session: "A", source: "hook", kind: "file-edited", files: ["sign-in.ts"] });
    const newerChanges = await reads.changesSince(shown, changes.cursor);
    assert.deepEqual(newerChanges.changes.map(({ recordId }) => recordId), [second.id], "only the newer change comes back");
    const newerLines = await reads.linesSince(shown, lines.cursor);
    assert.deepEqual(newerLines.lines.map(({ kind }) => kind), ["file-edited"], "only the newer line comes back");
  });
});

test("3.2 a name that is not a project is refused, and never created", async () => {
  const missing = uniqueProjectName();
  await withApp([missing], async ({ storytree, reads }) => {
    const asks: [string, () => Promise<unknown>][] = [
      ["its tree", () => reads.projectTree(missing)],
      ["an arc", () => reads.arcView(missing, "arc_1")],
      ["every arc", () => reads.arcViews(missing)],
      ["its holds", () => reads.holds(missing)],
      ["its changes", () => reads.changesSince(missing, 0)],
      ["its lines", () => reads.linesSince(missing, 0)],
      ["a shelf", () => reads.frontCovers(missing, "story_1")],
      ["a note's related notes", () => reads.relatedNotes(missing, "decision_1")],
    ];
    for (const [what, ask] of asks) {
      await assert.rejects(ask(), new RegExp(`there is no project called "${missing}"`), `asking for ${what} is refused`);
    }
    assert.ok(!(await storytree.listProjects()).includes(missing), "and asking created no project");
  });
});

test("3.4 the page can ask the app for a story's or capability's shelf of front covers, and for the notes that link to a note, for the project on show", async () => {
  const shown = uniqueProjectName();
  await withApp([shown], async ({ storytree, reads }) => {
    const library = await storytree.openProject(shown);
    const story = await library.addStory({ title: "Visitor can sign up" });
    const other = await library.addStory({ title: "Visitor can sign in" });
    const cover = await library.recordDecision({ status: "accepted", title: "Sign-up asks for an email only", text: "Nothing else, to keep it short.", frontCoverOf: story.id });
    await library.recordDecision({ status: "accepted", title: "Sign-in remembers the device", text: "For thirty days.", frontCoverOf: other.id });
    const why = await library.defineTerm({ term: "Name field drop-off", meaning: "Asking for a name lost a third of visitors.", links: [cover.id] });

    assert.deepEqual((await reads.frontCovers(shown, story.id)).map(({ id }) => id), [cover.id], "the story's shelf, and no other's");
    assert.deepEqual((await reads.relatedNotes(shown, cover.id)).map(({ id }) => id), [why.id]);
  });
});

/** A session that ran on another machine: its transcript streamed into the shared log there, and its file out of this app's reach. */
async function ranElsewhere(log: ActivityLog, project: string, session: string, records: readonly unknown[]): Promise<string> {
  const folder = mkdtempSync(path.join(tmpdir(), "reads-"));
  const transcript = path.join(folder, `${session}.jsonl`);
  try {
    writeFileSync(transcript, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
    await log.append(project, { session, harness: "claude-code", source: "hook", kind: "session-started", transcript });
    await shipTranscript(log, project, session, transcript);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return transcript;
}

test("3.5 the page can ask the app for the context readings of sessions in the project on show, each parsed from the transcript records in the shared log, with no access to the machine the session ran on (ADR-0749 D3)", async () => {
  const shown = uniqueProjectName();
  await withApp([shown], async ({ storytree, log, reads }) => {
    await storytree.openProject(shown);
    await ranElsewhere(log, shown, "A", [{ type: "assistant", requestId: "r1",
      message: { model: "claude-opus-5-5", usage: { input_tokens: 100, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 0 } } }]);
    await log.append(shown, { session: "B", harness: "codex", source: "hook", kind: "session-started" });

    const [a, b] = await reads.contextReadings(shown, ["A", "B"]);
    assert.equal(a?.session, "A");
    assert.equal(a !== undefined && "tokens" in a && a.tokens, 200_100);
    assert.deepEqual(b && "absent" in b && [b.session, b.absent], ["B", "no hook has named this session's transcript"]);
    await assert.rejects(reads.contextReadings(uniqueProjectName(), ["A"]), /there is no project called/);
  });
});

test("3.6 the page can ask the app for a session's window (agent link 9.10), or several sessions' in one ask, parsed from the transcript records in the shared log, with no access to the machine the session ran on; a session with none named reads as an absence", async () => {
  const shown = uniqueProjectName();
  await withApp([shown], async ({ storytree, log, reads }) => {
    await storytree.openProject(shown);
    await ranElsewhere(log, shown, "A", [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "c1", name: "mcp__storytree__open", input: { id: "decision_000000000001" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c1", content: "Claims" }] } },
    ]);

    const window = await reads.windowReading(shown, "A");
    assert.deepEqual("opens" in window && window.opens.map(({ id, resident }) => [id, resident]), [["decision_000000000001", true]]);
    const none = await reads.windowReading(shown, "B");
    assert.deepEqual("absent" in none && none.absent, "no hook has named this session's transcript");

    const both = await reads.windowReadings(shown, ["A", "B"]);
    assert.deepEqual(both.map((one) => [one.session, "opens" in one ? one.opens.length : one.absent]), [["A", 1], ["B", "no hook has named this session's transcript"]]);
    await assert.rejects(reads.windowReadings(shown, "A"), /sessions must be a list of session ids/);

    // The app keeps the log's lines between reads: a session named since the last read is still seen.
    await ranElsewhere(log, shown, "B", [{ type: "user", message: { content: "hello" } }]);
    const named = await reads.windowReading(shown, "B");
    assert.ok("opens" in named, "a session named since the last read has its window");
  });
});

// --- helpers ---------------------------------------------------------------------------------

interface App {
  storytree: Storytree;
  log: ActivityLog;
  reads: PageReads;
}

/** Run `body` with the app's reads over a connection to the test server, then close it all and drop `projects`' libraries. */
async function withApp(projects: readonly string[], body: (app: App) => Promise<void>): Promise<void> {
  const url = testServerUrl();
  const storytree = await connect({ url });
  const log = await openActivityLog(url);
  const reads = pageReads({ storytree });
  try {
    await body({ storytree, log, reads });
  } finally {
    await reads.close();
    await log.close();
    await storytree.close();
    await dropLibraries(projects);
  }
}

/** The server the tests run against: `pnpm test` starts one. A Postgres test must never skip silently. */
function testServerUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") {
    throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  }
  return url;
}

/** A project name no other test, and no earlier run, is using. */
function uniqueProjectName(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

/** Drop these projects' libraries, if there are any: the library keeps project `name` in the database `storytree_<name>`. */
async function dropLibraries(projects: readonly string[]): Promise<void> {
  const client = new pg.Client({ connectionString: testServerUrl() });
  await client.connect();
  try {
    for (const name of projects) await client.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
