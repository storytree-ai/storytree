/**
 * Capability 3 · Surfaces: the page's reads, contracts 3.1 and 3.2 in the app story, against the
 * real Postgres `pnpm test` provides. Each test works in projects named t- and 8 hex digits, so
 * tests sharing the server never read each other's, and drops their libraries afterwards.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ACTIVITY_DATABASE, openActivityLog, pruneTranscripts, RETAIN_MS, shipTranscript, type ActivityLog } from "@storytree/agent-link";
import { countingStore, longHistory } from "@storytree/agent-link/testing/egress";
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

test("3.8 the page can ask the app for the project's standing delegations, and a project without the register answers with none", async () => {
  const shown = uniqueProjectName();
  const bare = uniqueProjectName();
  await withApp([shown, bare], async ({ storytree, reads }) => {
    const library = await storytree.openProject(shown);
    await library.defineTerm({ term: "Name field drop-off", meaning: "Asking for a name lost a third of visitors." });
    await library.defineTerm({ term: "Standing delegation", meaning: "1. Reversible engineering choices." });
    await storytree.openProject(bare);

    assert.equal(await reads.standingDelegations(shown), "1. Reversible engineering choices.");
    assert.equal(await reads.standingDelegations(bare), undefined);
  });
});

/** A session that ran on another machine:its transcript streamed into the shared log there, and its file out of this app's reach. */
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

    // A session named since the last read is still seen.
    await ranElsewhere(log, shown, "B", [{ type: "user", message: { content: "hello" } }]);
    const named = await reads.windowReading(shown, "B");
    assert.ok("opens" in named, "a session named since the last read has its window");
  });
});

test("3.9 after each app start, context readings and single or batched windows read no more activity history from a long log than a short one", { timeout: 120_000 }, async (t) => {
  const projects = [uniqueProjectName(), uniqueProjectName()];
  await withApp(projects, async ({ storytree, log }) => {
    const taken: number[][] = [];
    let history = 0;
    for (const [index, project] of projects.entries()) {
      await storytree.openProject(project);
      if (index === 1) history = await longHistory(project, "/old-work", 400, "other-machine");
      for (const session of ["A", "B"]) {
        // Both named sessions have older references; only the latest reference places the reading.
        await log.append(project, { session, source: "hook", kind: "command-run", transcript: "/old/transcript.jsonl", command: "x".repeat(index === 1 ? 1_000_000 : 1) });
        const transcript = await ranElsewhere(log, project, session, [
          { type: "assistant", message: { model: "claude-opus-5-5", usage: { input_tokens: 321 }, content: [{ type: "tool_use", id: "c1", name: "mcp__storytree__open", input: { id: "decision_000000000001" } }] } },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c1", content: "Claims" }] } },
        ]);
        await log.append(project, { session, harness: "claude-code", source: "hook", kind: "command-run", transcript, command: "x".repeat(index === 1 ? 1_000_000 : 1) });
        // A newer line without a transcript must not hide the last reference that named one.
        await log.append(project, { session, source: "hook", kind: "turn-ended" });
      }
      const store = await countingStore();
      const url = new URL(testServerUrl());
      url.port = String(store.port);
      const counted = await connect({ url: url.href });
      const bytes: number[] = [];
      try {
        // Each entry point is the first read of a fresh main process, with no lines or transcripts cached.
        for (const kind of ["context", "windows", "window"] as const) {
          const reads = pageReads({ storytree: counted });
          const before = store.received();
          try {
            if (kind === "context") {
              const contexts = await reads.contextReadings(project, ["B", "A", "missing"]);
              assert.deepEqual(contexts.map((one) => [one.session, "tokens" in one ? one.tokens : one.absent]), [
                ["B", 321], ["A", 321], ["missing", "no hook has named this session's transcript"],
              ]);
              assert.deepEqual(await reads.contextReadings(project, []), []);
            } else {
              const windows = kind === "windows" ? await reads.windowReadings(project, ["B", "A"]) : [await reads.windowReading(project, "A")];
              assert.deepEqual(windows.map((one) => one.session), kind === "windows" ? ["B", "A"] : ["A"]);
              for (const window of windows) {
                assert.deepEqual("opens" in window && window.opens.map(({ id, resident }) => [id, resident]), [["decision_000000000001", true]]);
                assert.notEqual(window.source, "/old/transcript.jsonl");
              }
              assert.deepEqual(await reads.windowReadings(project, []), []);
            }
          } finally {
            await reads.close();
          }
          bytes.push(store.received() - before);
        }
        taken.push(bytes);
      } finally {
        await counted.close();
        await store.close();
      }
    }
    assert.ok(history > 20_000_000, `the long log has weeks of activity: ${history} bytes`);
    t.diagnostic(`startup bytes (context, windows, window): short ${taken[0]}, long ${taken[1]}; long history ${history} bytes`);
    for (let index = 0; index < 3; index++) {
      assert.ok(taken[1]![index]! - taken[0]![index]! < 128 * 1024,
        `startup read ${index} took ${taken[0]![index]} bytes from the short log and ${taken[1]![index]} from one ${history} bytes longer: at most 128 KiB apart`);
    }
  });
});


test("3.10 app restarts fetch only appended transcript records and preserve readings through compaction", { timeout: 120_000 }, async (t) => {
  const project = uniqueProjectName();
  const cacheHome = mkdtempSync(path.join(tmpdir(), "transcript-cache-"));
  try {
    await withApp([project], async ({ storytree, log }) => {
      await storytree.openProject(project);
      const records: unknown[] = [
        { uuid: "call", type: "assistant", message: { model: "claude", usage: { input_tokens: 4321 }, content: [
          { type: "tool_use", id: "old", name: "Read", input: { file_path: "old.ts" } },
          { type: "tool_use", id: "kept", name: "Read", input: { file_path: "kept.ts" } },
        ] } },
        { uuid: "old", type: "user", message: { content: [{ type: "tool_result", tool_use_id: "old", content: "decision_000000000001" }] } },
        ...Array.from({ length: 128 }, (_, i) => ({ uuid: `large-${i}`, type: "user", message: { content: "x".repeat(64 * 1024) } })),
        { uuid: "kept", type: "user", message: { content: [{ type: "tool_result", tool_use_id: "kept", content: "decision_000000000002" }] } },
      ];
      let cursor = 0;
      const append = async (added: unknown[]) => {
        const batch = added.map((value) => {
          const record = JSON.stringify(value);
          const start = cursor;
          cursor += Buffer.byteLength(record) + 1;
          return { part: "", start, finish: cursor, record };
        });
        await log.transcripts.store(project, "session", batch);
      };
      await log.append(project, { session: "session", source: "hook", kind: "session-started", harness: "claude-code", transcript: "/remote/session.jsonl" });
      await append(records);
      const store = await countingStore();
      const url = new URL(testServerUrl());
      url.port = String(store.port);
      const counted = await connect({ url: url.href });
      const take = async () => {
        const reads = pageReads({ storytree: counted, transcriptCacheHome: cacheHome });
        const before = store.received();
        try {
          const [contexts, window, windows] = await Promise.all([
            reads.contextReadings(project, ["session"]), reads.windowReading(project, "session"), reads.windowReadings(project, ["session"]),
          ]);
          assert.deepEqual(stable(window), stable(windows[0]!));
          return { context: contexts[0]!, window, bytes: store.received() - before };
        } finally { await reads.close(); }
      };
      try {
        const cold = await take();
        assert.ok(cold.bytes > 8_000_000, `cold read fetched the long transcript: ${cold.bytes}`);
        const restarted = await take();
        assert.deepEqual(stable(restarted.context), stable(cold.context));
        assert.deepEqual(stable(restarted.window), stable(cold.window));
        t.diagnostic(`transcript server bytes: cold ${cold.bytes}; restarted ${restarted.bytes}`);
        assert.ok(restarted.bytes < 128 * 1024, `restart fetched ${restarted.bytes} bytes, expected only the tail`);
        const tail = [
          { type: "system", subtype: "compact_boundary", compactMetadata: { preservedSegment: { headUuid: "kept", tailUuid: "kept" } } },
          { type: "assistant", message: { model: "claude", usage: { input_tokens: 8765 }, content: [{ type: "tool_use", id: "new", name: "Read", input: { file_path: "new.ts" } }] } },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "new", content: "decision_000000000003" }] } },
        ];
        await append(tail);
        const updated = await take();
        assert.equal("tokens" in updated.context && updated.context.tokens, 8765);
        assert.deepEqual("opens" in updated.window && updated.window.opens.map(({ id, resident }) => [id, resident]), [["old.ts", false], ["kept.ts", true], ["new.ts", true]]);
        assert.equal("compactions" in updated.window && updated.window.compactions, 1);
        assert.ok(updated.bytes < 128 * 1024, `append after restart fetched ${updated.bytes} bytes`);
        const freshHome = mkdtempSync(path.join(tmpdir(), "transcript-full-"));
        const fresh = pageReads({ storytree, transcriptCacheHome: freshHome });
        try {
          const [expected] = await fresh.contextReadings(project, ["session"]);
          assert.deepEqual("composition" in updated.context && updated.context.composition, expected && "composition" in expected && expected.composition);
        } finally { await fresh.close(); rmSync(freshHome, { recursive: true, force: true }); }
      } finally { await counted.close(); await store.close(); }
    });
  } finally { rmSync(cacheHome, { recursive: true, force: true }); }
});

test("3.10 a Codex session's kept records survive a torn or unreadable checkpoint and a store holding less, and retention retires them for the kept reading", { timeout: 120_000 }, async (t) => {
  const project = uniqueProjectName();
  const cacheHome = mkdtempSync(path.join(tmpdir(), "transcript-cache-"));
  try {
    await withApp([project], async ({ storytree, log }) => {
      await storytree.openProject(project);
      const tokens = (input: number) => ({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 1 }, model_context_window: 258_400 } } });
      let cursor = 0;
      const append = async (added: unknown[]) => {
        await log.transcripts.store(project, "codex", added.map((value) => {
          const record = JSON.stringify(value);
          const start = cursor;
          cursor += Buffer.byteLength(record) + 1;
          return { part: "", start, finish: cursor, record };
        }));
      };
      await log.append(project, { session: "codex", source: "hook", kind: "session-started", harness: "codex", transcript: "/remote/rollout.jsonl" });
      await append([{ type: "session_meta", payload: { id: "codex" } }, ...Array.from({ length: 32 }, (_, i) => ({ type: "response_item", payload: { id: i, text: "x".repeat(64 * 1024) } })), tokens(1000)]);
      const store = await countingStore();
      const url = new URL(testServerUrl());
      url.port = String(store.port);
      const counted = await connect({ url: url.href });
      const read = async () => {
        const reads = pageReads({ storytree: counted, transcriptCacheHome: cacheHome });
        const before = store.received();
        try {
          const [context] = await reads.contextReadings(project, ["codex"]);
          return { tokens: context && ("tokens" in context ? context.tokens : context.absent), bytes: store.received() - before };
        } finally { await reads.close(); }
      };
      const checkpoints = () => readdirSync(cacheHome, { recursive: true, withFileTypes: true }).filter((one) => one.isFile()).map((one) => path.join(one.parentPath, one.name));
      try {
        assert.equal((await read()).tokens, 1000);
        const [file] = checkpoints();
        assert.ok(file !== undefined, "the records are kept on disk");

        // A torn write, then a batch written twice: what continues is kept, the rest fetched again.
        const lines = readFileSync(file, "utf8").trimEnd().split("\n");
        writeFileSync(file, `${lines.join("\n")}\n{"from":12,"fini\n${lines.at(-1)}\n`);
        await append([tokens(2000)]);
        const torn = await read();
        t.diagnostic(`server bytes after a torn checkpoint: ${torn.bytes}`);
        assert.deepEqual(torn.tokens, 2000);
        assert.ok(torn.bytes < 128 * 1024, `a torn checkpoint fetched ${torn.bytes} bytes`);
        for (const line of readFileSync(file, "utf8").trimEnd().split("\n")) JSON.parse(line);

        writeFileSync(file, "not a checkpoint");
        assert.equal((await read()).tokens, 2000, "an unreadable checkpoint is fetched again whole");

        // The store now holds less than was kept (emptied, or another one): the checkpoint is not trusted.
        await activityQuery("DELETE FROM transcript_records WHERE project = $1", [project]);
        cursor = 0;
        await append([{ type: "session_meta", payload: { id: "codex" } }, tokens(3000)]);
        assert.equal((await read()).tokens, 3000);

        // Retention keeps the reading before the raw records go, and the checkpoint goes with them.
        // Only this project's records age: pruning in the future would expire concurrent tests' records too.
        await activityQuery("UPDATE transcript_records SET at = at - $2 * interval '1 millisecond' WHERE project = $1", [project, RETAIN_MS + 60_000]);
        await pruneTranscripts(log);
        assert.equal((await read()).tokens, 3000);
        assert.deepEqual(checkpoints(), []);
      } finally { await counted.close(); await store.close(); }
    });
  } finally { rmSync(cacheHome, { recursive: true, force: true }); }
});

// --- helpers ---------------------------------------------------------------------------------

/** A reading without the moment it was taken, to compare two takes of it. */
function stable<T extends { at: string }>(value: T): Omit<T, "at"> {
  const { at: _at, ...rest } = value;
  return rest;
}

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

/** Run one statement against the activity database directly, as another writer of it would. */
async function activityQuery(text: string, values: unknown[]): Promise<void> {
  const url = new URL(testServerUrl());
  url.pathname = `/${ACTIVITY_DATABASE}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
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
  const client = new pg.Client({ connectionString: process.env["STORYTREE_TEST_PG_ADMIN_URL"] || testServerUrl() });
  await client.connect();
  try {
    for (const name of projects) await client.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
