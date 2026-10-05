/**
 * Capability 2 · Agent activity log: one test per contract 2.1-2.7 in the agent link story, against
 * the real Postgres `pnpm test` provides. Each test writes under projects named with
 * uniqueProjectName(), so tests sharing the server never read each other's lines.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect as connectTo, createServer, type AddressInfo, type Socket } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";

import { databasesOnTestServer, dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { ACTIVITY_DATABASE, cachedLines, openActivityLog, type ActivityLog, type Line, type LinesCache, type NewLine } from "./index.js";

const WRITER = fileURLToPath(new URL("../testing/activity-writer.ts", import.meta.url));

/** Run `body` with the log open on the test server, and close it afterwards. */
async function withLog(body: (log: ActivityLog) => Promise<void>): Promise<void> {
  const log = await openActivityLog(testServerUrl());
  try {
    await body(log);
  } finally {
    await log.close();
  }
}

/** Run the writer in a process of its own, resolving once it has exited cleanly. */
function writeFromAnotherProcess(project: string, session: string, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", WRITER, testServerUrl(), project, session, String(count)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`the writer for ${session} exited ${code}: ${stderr}`))));
  });
}

/** The command a `command-run` line carries. */
function commandOf(line: Line): string {
  assert.equal(line.kind, "command-run");
  return line.command;
}

test("2.1 two separate processes write lines for two sessions, and reading from the start returns every line once, in the order written", async () => {
  const project = uniqueProjectName();
  const count = 60;
  await withLog(async (log) => {
    // Follow along while they write, passing back each cursor handed out: a line that commits late
    // must still be read, and none twice.
    let writing = true;
    const writers = Promise.all(["A", "B"].map((session) => writeFromAnotherProcess(project, session, count))).finally(() => {
      writing = false;
    });
    const followed: Line[] = [];
    let cursor = 0;
    while (writing) {
      const read = await log.since(project, cursor);
      followed.push(...read.lines);
      cursor = read.cursor;
    }
    await writers;
    followed.push(...(await log.since(project, cursor)).lines);

    const all = (await log.since(project, 0)).lines;
    assert.equal(all.length, 2 * count, "every line, once");
    assert.equal(new Set(all.map((line) => line.seq)).size, all.length, "no line twice");
    assert.deepEqual(
      followed.map((line) => line.seq),
      all.map((line) => line.seq),
      "reading along as they wrote saw the same lines, in the same order",
    );
    for (let index = 1; index < all.length; index++) {
      assert.ok(all[index]!.seq > all[index - 1]!.seq, "numbered in the order read back");
    }
    const steps = Array.from({ length: count }, (_, index) => `step ${index + 1}`);
    for (const session of ["A", "B"]) {
      assert.deepEqual(
        all.filter((line) => line.session === session).map(commandOf),
        steps,
        `session ${session}'s lines in the order it wrote them`,
      );
    }
  });
});

test('2.2 reading "since line N" returns only the lines after N, in order, each carrying the number to pass next time', async () => {
  const project = uniqueProjectName();
  await withLog(async (log) => {
    const written: Line[] = [];
    for (let step = 1; step <= 8; step++) {
      written.push(await log.append(project, { session: "s", harness: "codex", source: "hook", kind: "command-run", command: `step ${step}` }));
    }
    const read = await log.since(project, written[4]!.seq);
    assert.deepEqual(read.lines.map(commandOf), ["step 6", "step 7", "step 8"]);
    assert.deepEqual(read.lines, written.slice(5), "each line as appending it returned it");
    assert.equal(read.cursor, written[7]!.seq, "the cursor to pass next time is the last line's number");
    assert.deepEqual(await log.since(project, read.cursor), { lines: [], cursor: read.cursor }, "nothing newer: no lines, the same cursor");
    assert.deepEqual(
      written.map(({ project: of, session, harness, source }) => ({ of, session, harness, source })),
      Array.from({ length: 8 }, () => ({ of: project, session: "s", harness: "codex", source: "hook" })),
    );
  });
});

test("a reader that asks again and again, through a lines cache, fetches a project's log from the start once and then only from its cursor, and sees each line added in between", async () => {
  const project = uniqueProjectName();
  await withLog(async (log) => {
    const asked: number[] = [];
    const watched: ActivityLog = Object.assign(Object.create(log) as ActivityLog, {
      since: (of: string, cursor: number) => (asked.push(cursor), log.since(of, cursor)),
    });
    const cache: LinesCache = new Map();
    await log.append(project, { session: "A", source: "hook", kind: "session-started" });
    const first = await cachedLines(watched, project, cache);
    await log.append(project, { session: "A", source: "hook", kind: "session-ended" });
    const [second, third] = await Promise.all([cachedLines(watched, project, cache), cachedLines(watched, project, cache)]);

    assert.deepEqual(first.map(({ kind }) => kind), ["session-started"]);
    assert.deepEqual(second.map(({ kind }) => kind), ["session-started", "session-ended"], "the line added in between is seen");
    assert.deepEqual(third, second, "two asks at once read each line once");
    assert.deepEqual(asked, [0, first[0]!.seq, second[1]!.seq], "from the start once, then only from the cursor");
  });
});

test('2.3 lines written for project "site" never appear when reading project "app"', async () => {
  const site = uniqueProjectName();
  const app = uniqueProjectName();
  await withLog(async (log) => {
    await log.append(site, { session: "s1", source: "hook", kind: "file-edited", files: ["index.html"] });
    const appLine = await log.append(app, { session: "s2", source: "hook", kind: "file-edited", files: ["main.ts"] });
    await log.append(site, { session: "s1", source: "hook", kind: "command-run", command: "npm test" });

    const siteLines = (await log.since(site, 0)).lines;
    assert.deepEqual(siteLines.map((line) => [line.project, line.session, line.kind]), [
      [site, "s1", "file-edited"],
      [site, "s1", "command-run"],
    ]);
    assert.deepEqual((await log.since(app, 0)).lines, [appLine]);
    assert.deepEqual((await log.since(app, appLine.seq)).lines, [], "site's later line is not app's, whatever its number");
  });
});

/**
 * A stand-in for the test server whose first connection is reset before anything is said, as
 * Postgres on Windows sometimes resets a connection it is refusing (one to a database not made
 * yet) before its refusal arrives. Every later connection is passed through to the test server.
 */
async function firstConnectionReset(): Promise<{ url: string; close(): Promise<void> }> {
  const target = new URL(testServerUrl());
  const sockets = new Set<Socket>();
  let first = true;
  const server = createServer((client) => {
    sockets.add(client);
    if (first) {
      first = false;
      client.resetAndDestroy();
      return;
    }
    const upstream = connectTo(Number(target.port), target.hostname);
    sockets.add(upstream);
    const end = (): void => {
      client.destroy();
      upstream.destroy();
    };
    for (const socket of [client, upstream]) socket.on("error", end).on("close", end);
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(target.href);
  url.port = String((server.address() as AddressInfo).port);
  return {
    url: url.href,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

test("2.6 a line may name the earlier line of its own project's log that caused it, and reads back naming it; one naming a line its project's log does not hold is refused, and nothing is written", async () => {
  const site = uniqueProjectName();
  const app = uniqueProjectName();
  await withLog(async (log) => {
    const request = await log.append(app, { session: "s1", source: "hook", kind: "tool-requested", tool: "open", call: "c1", agent: "orchestrator" });
    const elsewhere = await log.append(site, { session: "s2", source: "hook", kind: "session-started" });
    const called = await log.append(app, { session: "s1", source: "tool", kind: "tool-called", tool: "open", causedBy: request.seq });
    assert.equal((await log.since(app, request.seq)).lines[0]?.causedBy, request.seq);
    assert.equal(called.causedBy, request.seq);

    for (const causedBy of [elsewhere.seq, called.seq + 1_000_000]) {
      await assert.rejects(log.append(app, { session: "s1", source: "tool", kind: "tool-called", tool: "open", causedBy }), /cause/);
      await assert.rejects(log.locked(app, (locked) => locked.append({ session: "s1", source: "tool", kind: "tool-called", tool: "open", causedBy })), /cause/);
    }
    assert.deepEqual((await log.since(app, called.seq)).lines, [], "a refused line is never written");
  });
});

test("the log opens even when Postgres on Windows resets its first connection, as it did the first time the log was opened in a fresh cluster (regression: the Windows run of storytree-ai/storytree#11)", async () => {
  const project = uniqueProjectName();
  const server = await firstConnectionReset();
  try {
    const log = await openActivityLog(server.url);
    try {
      const line = await log.append(project, { session: "s", source: "hook", kind: "command-run", command: "npm test" });
      assert.deepEqual((await log.since(project, 0)).lines, [line]);
    } finally {
      await log.close();
    }
  } finally {
    await server.close();
  }
});

test("2.4 the log never shows up in the library's list of projects, and writing lines leaves the library's own records and change feed untouched", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(project);
    await library.addStory({ title: "Visitor can sign up" });
    const before = await library.changesSince(0);
    const tree = await library.projectTree();

    await withLog(async (log) => {
      await log.append(project, { session: "s", harness: "claude-code", source: "hook", kind: "session-started", folder: "/work/site", how: "startup" });
      await log.append(project, { session: "s", source: "tool", kind: "claimed", capability: "capability_1", reason: "building the email form" });
      await log.append(project, { session: "s", source: "tool", kind: "note-read", note: "memory_1", found: "search", read: "peek" });
    });

    assert.deepEqual(await library.changesSince(before.cursor), { changes: [], cursor: before.cursor }, "the change feed is untouched");
    assert.deepEqual(await library.projectTree(), tree, "the records are untouched");

    assert.ok((await databasesOnTestServer()).includes(ACTIVITY_DATABASE), "the log lives on the same server");
    const projects = await storytree.listProjects();
    assert.ok(projects.includes(project));
    assert.equal(
      projects.some((name) => `storytree_${name}` === ACTIVITY_DATABASE || name === ACTIVITY_DATABASE),
      false,
      "the log's database is not listed as a project",
    );
  } finally {
    await storytree.close();
    await dropTestProjects([project]);
  }
});

test("2.7 a bounded read sends only the lines it asks for, oldest first: by kind, session, cursor and time, by a field's value, values or absence, by a field carried, the latest for each key, the newest or oldest few, and inside folders whatever their case or slashes, with the fields it never reads left out", async () => {
  const project = uniqueProjectName();
  await withLog(async (log) => {
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const write = (line: Record<string, unknown>, minutesAgo = 0) => log.append(project, { source: "hook", ...line } as NewLine, minutesAgo === 0 ? {} : { at: at(minutesAgo) });
    const old = await write({ session: "A", kind: "command-started", command: "x".repeat(2_000), call: "c1", folder: "C:\\Work\\Site" }, 120);
    const finish = await write({ session: "A", kind: "command-run", command: "x".repeat(2_000), call: "c1", folder: "C:\\Work\\Site\\pkg" }, 119);
    const edit = await write({ session: "B", kind: "file-edited", files: ["src/a.ts"], folder: "/work/other", machine: "mint", transcript: "/t/b.jsonl" }, 30);
    const call = await write({ session: "B", kind: "tool-requested", tool: "open", call: "call-9", agent: "orchestrator", folder: "/work/other" }, 20);
    const state1 = await write({ session: "W", kind: "branch-state", of: "feat", open: true, how: "ahead" }, 10);
    const state2 = await write({ session: "W", kind: "branch-state", of: "feat", open: false, how: "merged", pr: 4 }, 5);
    const other = await write({ session: "W", kind: "branch-state", of: "fix", open: true, how: "ahead" }, 4);
    const seqs = (lines: readonly Line[]) => lines.map((line) => line.seq);

    assert.deepEqual(seqs(await log.lines(project, { kinds: ["branch-state"] })), [state1.seq, state2.seq, other.seq], "by kind, oldest first");
    assert.deepEqual(seqs(await log.lines(project, { sessions: ["A", "B"], after: old.seq })), [finish.seq, edit.seq, call.seq], "by session, after a cursor");
    assert.deepEqual(seqs(await log.lines(project, { since: at(25) })), [call.seq, state1.seq, state2.seq, other.seq], "written since a time");
    assert.deepEqual(seqs(await log.lines(project, { where: { call: "call-9" } })), [call.seq], "by a field's value");
    assert.deepEqual(seqs(await log.lines(project, { where: { of: ["fix", "none"] } })), [other.seq], "by one of a field's values");
    assert.deepEqual(seqs(await log.lines(project, { where: { machine: null, session: "B" } })), [call.seq], "by a field's absence");
    assert.deepEqual(seqs(await log.lines(project, { has: ["transcript"] })), [edit.seq], "by a field carried");
    assert.deepEqual(seqs(await log.lines(project, { kinds: ["branch-state"], latestBy: ["of"] })), [state2.seq, other.seq], "the latest for each key");
    assert.deepEqual(seqs(await log.lines(project, { newest: 2 })), [state2.seq, other.seq], "the newest few, oldest first");
    assert.deepEqual(seqs(await log.lines(project, { oldest: 2 })), [old.seq, finish.seq], "the oldest few");
    assert.deepEqual(seqs(await log.lines(project, { within: ["c:/work/site/"] })), [old.seq, finish.seq], "inside a folder, whatever its case or slashes");
    assert.deepEqual(seqs(await log.lines(project, { within: ["/work/oth"] })), [], "a folder's name is no prefix of another's");

    const [slim] = await log.lines(project, { kinds: ["command-started"], omit: ["command"] });
    assert.deepEqual({ ...slim, command: undefined }, { ...old, command: undefined });
    assert.equal((slim as { command?: string }).command, undefined, "a field left out is not sent");
    assert.deepEqual(await log.lines(project, { sessions: [] }), [], "no sessions, no lines");
  });
});
