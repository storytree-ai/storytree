/**
 * The librarian story's rounds 6.3–6.4: the real shared server serves curation and gives the session
 * its next step. Kept here, beside the server, because the librarian cannot depend back on Session management.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { librarianTools } from "@storytree/librarian";
import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog } from "@storytree/session-management";
import { approveCheckout, dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/session-management/testing/pg";
import { createAgentTools } from "./index.js";

const VERBS = ["worklist", "link", "supersede", "correct", "annotate", "retire", "park", "graduate", "route"];

/** Run `body` with a fresh project's library, dropped afterwards, pass or fail. */
async function withLibrary(body: (library: Library) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(project);
    try {
      await body(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestProjects([project]);
  }
}

async function withClient(body: (world: { client: Client; library: Library; log: ActivityLog; folder: string }) => Promise<void>): Promise<void> {
  await withLibrary(async (library) => {
    const folder = mkdtempSync(path.join(tmpdir(), "librarian-tools-"));
    writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project: library.name }));
    await approveCheckout(folder, library.name);
    const log = await openActivityLog(testServerUrl());
    const tools = createAgentTools({
      folder, dataDir: process.env.STORYTREE_TEST_PG_DATA!, env: {},
      extensions: [librarianTools()], merges: { mergedPulls: async () => [] },
    });
    const client = new Client({ name: "codex-mcp-client", version: "test" });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    try {
      await tools.server.connect(serverSide);
      await client.connect(clientSide);
      await body({ client, library, log, folder });
    } finally {
      await client.close();
      await tools.close();
      await log.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}, session = "curator") {
  const result = await client.callTool({ name, arguments: args, _meta: { sessionId: session, threadId: `${session}-subagent` } });
  return { ...result, structuredContent: result.structuredContent as Record<string, unknown> };
}

async function fields(library: Library, id: string): Promise<Record<string, unknown>> {
  const record = await library.get(id);
  assert.ok(record);
  return record.fields;
}

test("(the librarian's 6.4) the shared server lists and calls every librarian verb, attributes writes and preserves refusals", async () => {
  await withClient(async ({ client, library, log, folder }) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("land") && VERBS.every((name) => names.includes(name)));
    assert.ok(VERBS.every((name) => client.getInstructions()!.includes(`\`${name}\``)));
    assert.ok(client.getInstructions()!.split("\n").length <= 60);
    execFileSync("git", ["init", "-b", "curation"], { cwd: folder, stdio: "pipe" });
    const memory = path.join(folder, "memory");
    mkdirSync(memory);
    const kept = path.join(memory, "keep.md");
    const durable = path.join(memory, "lesson.md");
    writeFileSync(kept, "Remember the current experiment.");
    writeFileSync(durable, "One library is the source of truth.");
    const first = await library.recordDecision({ title: "One copy", text: "Use the library", status: "accepted", loadBearing: true });
    const narrowing = await library.recordDecision({ title: "File by shelf", text: "Put covers on shelves", status: "accepted" });
    const discarded = await library.defineTerm({ term: "Draft", meaning: "Obsolete wording" });
    const frictionFields = { title: "Missing tool", description: "The curator cannot act", statement: "Serve curation", evidence: "worklist: unknown tool", impact: "A pass stops" };
    const own = await library.writeKnowledge("friction", { ...frictionFields, provenance: { branch: "curation", date: "2026-09-27", source: "retro" } });
    const friction = await library.writeKnowledge("friction", { ...frictionFields, provenance: { branch: "other", date: "2026-09-27", source: "retro" } });
    let cursor = (await library.changesSince(0)).cursor;
    async function write(name: string, args: Record<string, unknown>, session = "curator") {
      const result = await call(client, name, args, session);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const changes = await library.history({ since: cursor });
      assert.ok(changes.length > 0, `${name} wrote`);
      assert.ok(changes.every((entry) => entry.actor === `session:${session}`), `${name} names its caller`);
      cursor = changes.at(-1)!.seq;
      return result.structuredContent as Record<string, unknown>;
    }
    const listed = await call(client, "worklist", { memoryFolders: [memory], tools: names });
    const work = listed.structuredContent!.worklist as { graduation: { file: string }[]; friction: { id: string }[]; rest: { processes: { tools: string[] } } };
    assert.deepEqual(work.graduation.map((item) => item.file), [kept, durable]);
    assert.ok(work.friction.some((item) => item.id === friction.id));
    assert.ok(!work.friction.some((item) => item.id === own.id));
    assert.deepEqual(work.rest.processes.tools, names);
    await write("link", { from: narrowing.id, to: first.id });
    assert.deepEqual((await fields(library, narrowing.id)).links, [first.id]);
    await write("correct", { id: first.id, fields: { text: "The library holds the single copy", loadBearing: false } });
    assert.equal((await fields(library, first.id)).loadBearing, false);
    await write("annotate", { target: first.id, by: narrowing.id, note: "Shelf placement narrows this", date: "2026-09-27" });
    assert.match(String((await fields(library, first.id)).text), /Shelf placement narrows this/);
    await write("correct", { id: first.id, fields: { loadBearing: true } });
    const successor = await write("supersede", { olds: [first.id], successor: { title: "One live copy", text: "The library is authoritative" } });
    assert.equal((await library.decision(first.id))?.status, "superseded");
    assert.equal((await fields(library, successor.id as string)).loadBearing, true);
    assert.equal((await fields(library, first.id)).loadBearing, undefined);
    await write("retire", { id: discarded.id, reason: "No longer used" });
    assert.equal(await library.get(discarded.id), null);
    assert.notEqual((await call(client, "park", { memory: kept, reason: "This experiment is still running" })).isError, true);
    const parked = await call(client, "worklist", { memoryFolders: [memory] });
    assert.deepEqual((parked.structuredContent!.worklist as typeof work).graduation.map((item) => item.file), [durable]);
    assert.equal((await call(client, "graduate", { memory: durable, kind: "definition", fields: { term: "Missing meaning" } })).isError, true);
    assert.ok(existsSync(durable), "a refused graduation keeps its source");
    const graduated = await write("graduate", { memory: durable, kind: "definition", fields: { term: "Library", meaning: "The single copy" } }, "after-clear");
    assert.equal((await fields(library, graduated.id as string)).meaning, "The single copy");
    assert.ok(!existsSync(durable));
    const historyBeforeRoute = await library.history();
    const unparked = await call(client, "route", { friction: friction.id, route: "tool", reason: "Build the missing verb" });
    assert.equal(unparked.isError, true);
    assert.deepEqual(await library.history(), historyBeforeRoute);
    await write("route", { friction: friction.id, route: "tool", reason: "The missing verb is now served", dischargedBy: "  #42  " });
    assert.equal((await fields(library, friction.id)).route, "tool");
    assert.equal((await fields(library, friction.id)).dischargedBy, "#42");
    await write("route", { friction: friction.id, route: "tool", reason: "Clarify the delivered remedy" });
    assert.equal((await fields(library, friction.id)).dischargedBy, "#42");
    const before = await library.history();
    const refused = await call(client, "correct", { id: narrowing.id, fields: { status: "proposed" } });
    assert.equal(refused.isError, true);
    assert.match(JSON.stringify(refused.content), /only the owner/);
    assert.deepEqual(await library.history(), before);
    const called = (await log.since(library.name, 0)).lines.filter((line) => line.kind === "tool-called").map((line) => line.tool);
    assert.ok(VERBS.every((name) => called.includes(name)), "all use the shared activity wrapper");
  });
});

test("6.3 land and worklist use the calling session's start, including resumed and unknown sessions", async () => {
  await withClient(async ({ client, library, log }) => {
    const story = await library.addStory({ title: "Library" });
    const capability = await library.addCapability({ story: story.id, title: "Rounds" });
    await library.recordDecision({ title: "Earlier", text: "An earlier decision", status: "accepted" });
    await setTimeout(5); // Order the two databases' millisecond timestamps without an ambiguous boundary.
    await log.append(library.name, { session: "curator", harness: "codex", source: "hook", kind: "session-started" });
    const quiet = await call(client, "land", { capability: capability.id });
    assert.notEqual(quiet.isError, true);
    assert.doesNotMatch(JSON.stringify(quiet.content), /Next:/);
    const quietWork = await call(client, "worklist", { memoryFolders: [] });
    assert.deepEqual(quietWork.structuredContent!.worklist, { graduation: [], friction: [] });
    await library.defineTerm({ term: "Round", meaning: "A librarian's pass" });
    await setTimeout(5);
    await log.append(library.name, { session: "curator", harness: "codex", source: "hook", kind: "session-started", how: "resume" });
    const due = await call(client, "land", { capability: capability.id });
    assert.deepEqual(due.structuredContent!.next, ["run the librarian's pass"]);
    const unknown = await call(client, "land", { capability: capability.id }, "missing-start");
    assert.deepEqual(unknown.structuredContent!.next, ["run the librarian's pass"]);
    await log.append(library.name, { session: "fresh", harness: "codex", source: "hook", kind: "session-started" });
    const fresh = await call(client, "land", { capability: capability.id }, "fresh");
    assert.doesNotMatch(JSON.stringify(fresh.content), /Next:/);
  });
});

test("(the librarian's 6.4) the installed server enables the librarian for storytree's own library first", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "librarian-install-"));
  try {
    for (const project of ["storytree", "another-project"]) {
      writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project }));
      const tools = createAgentTools({ folder, env: {} });
      const client = new Client({ name: "claude-code", version: "test" });
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
      try {
        await tools.server.connect(serverSide);
        await client.connect(clientSide);
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        assert.ok(VERBS.every((name) => names.includes(name) === (project === "storytree")));
      } finally {
        await client.close();
        await tools.close();
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
