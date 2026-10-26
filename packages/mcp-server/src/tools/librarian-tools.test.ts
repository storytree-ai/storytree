/**
 * The library story's rounds 26.3–26.4: the real shared server serves curation and gives the session
 * its next step. Kept here, beside the server, because the librarian cannot depend back on Session management.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { librarianTools } from "@storytree/library/librarian";
import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog } from "@storytree/session-management";
import { approveCheckout, dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { CARD_WORD_BUDGET, cardWords } from "../instructions/habits.js";
import { waitUntil } from "@storytree/test-waits";
import { withAgent } from "../testing/agent.js";
import { withProject } from "../testing/tool-world.js";
import { createAgentTools } from "./index.js";

const VERBS = ["worklist", "link", "supersede", "correct", "annotate", "retire", "park", "graduate"];

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

test("library 26.4 the shared server lists and calls every librarian verb, attributes writes and preserves refusals", async () => {
  await withClient(async ({ client, library, log, folder }) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("land") && VERBS.every((name) => names.includes(name)));
    assert.ok(VERBS.every((name) => client.getInstructions()!.includes(`\`${name}\``)));
    assert.ok(cardWords(client.getInstructions()!) <= CARD_WORD_BUDGET);
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
    const work = listed.structuredContent!.worklist as { graduation: { file: string }[]; rest: { processes: { tools: string[] } } };
    assert.deepEqual(work.graduation.map((item) => item.file), [kept, durable]);
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
    cursor = (await library.changesSince(cursor)).cursor;
    assert.equal((await call(client, "graduate", { memory: durable, kind: "definition", fields: { term: "Missing meaning" } })).isError, true);
    assert.ok(existsSync(durable), "a refused graduation keeps its source");
    const graduated = await write("graduate", { memory: durable, kind: "definition", fields: { term: "Library", meaning: "The single copy" } }, "after-clear");
    assert.equal((await fields(library, graduated.id as string)).meaning, "The single copy");
    assert.ok(!existsSync(durable));
    const before = await library.history();
    const refused = await call(client, "correct", { id: narrowing.id, fields: { status: "proposed" } });
    assert.equal(refused.isError, true);
    assert.match(JSON.stringify(refused.content), /only the owner/);
    assert.deepEqual(await library.history(), before);
    const called = (await log.since(library.name, 0)).lines.filter((line) => line.kind === "tool-called").map((line) => line.tool);
    assert.ok(VERBS.every((name) => called.includes(name)), "all use the shared activity wrapper");
  });
});

test("library 26.3 land and worklist use the calling session's start, including resumed and unknown sessions", async () => {
  await withClient(async ({ client, library, log }) => {
    const story = await library.addStory({ title: "Library" });
    const capability = await library.addCapability({ story: story.id, title: "Rounds" });
    await library.recordDecision({ title: "Earlier", text: "An earlier decision", status: "accepted" });
    await clockMovesOn(); // Order the two databases' millisecond timestamps without an ambiguous boundary.
    await log.append(library.name, { session: "curator", harness: "codex", source: "hook", kind: "session-started" });
    const quiet = await call(client, "land", { capability: capability.id });
    assert.notEqual(quiet.isError, true);
    assert.doesNotMatch(JSON.stringify(quiet.content), /Next:/);
    const quietWork = await call(client, "worklist", { memoryFolders: [] });
    assert.deepEqual(quietWork.structuredContent!.worklist, { graduation: [] });
    await library.defineTerm({ term: "Round", meaning: "A librarian's pass" });
    await clockMovesOn();
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

test("library 26.11 through the worklist and land tools, a mounted factory plugin's guidance is offered after a write to its kind, the server handing each call the kinds its plugins declare", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    const home = mkdtempSync(path.join(tmpdir(), "librarian-plugin-"));
    try {
      await approveCheckout(folder, project, home);
      const plugin = path.join(home, "factory", "plugins", "my-health");
      mkdirSync(plugin, { recursive: true });
      writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-health", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: {
        interface: 1, verbs: [{ from: "./verbs", export: "families" }],
        recordKinds: [{ kind: "my-health.reading", version: 1, fields: { type: "object", properties: { words: { type: "string" } }, required: ["words"] }, writers: ["my_health"] }],
      } }));
      writeFileSync(path.join(plugin, "verbs.js"), `const note = {
  command: { family: "health", name: "note", summary: "keep a health reading" },
  tool: { name: "my_health_note", description: "keep a health reading" },
  inputs: { words: { kind: "text", word: 0, describe: "the reading" } },
  act: async ({ words }, { library, writer }) => ({ text: (await library.createPluginRecord("my-health.reading", { words }, writer)).id }),
};
export const families = [{ name: "health", summary: "my own health", order: 18, verbs: [note] }];
`);
      writeFileSync(path.join(home, "settings.json"), JSON.stringify({ factory: path.join(home, "factory"), "parts-off": ["experiments"], "stand-ins": { experiments: "my-health" } }));
      const story = await library.addStory({ title: "Library" });
      const capability = await library.addCapability({ story: story.id, title: "Rounds" });
      const steps = { statement: "Fold old readings.", trigger: "A reading is kept.", steps: "Fold them.", surfaces: "The library.", failureModes: "A reading lost." };
      await library.writeKnowledge("process", { title: "my-health: fold old readings", description: "My health's curation.", ...steps });
      await clockMovesOn();
      await log.append(project, { session: "curator", harness: "codex", source: "hook", kind: "session-started" });
      const meta = { sessionId: "curator", threadId: "curator-subagent" };

      await withAgent(folder, { client: "codex-mcp-client", meta, extensions: [librarianTools()], merges: { mergedPulls: async () => [] }, setup: { storytreeHome: home } }, async (agent) => {
        assert.deepEqual((await agent.call("worklist", { memoryFolders: [] })).data.worklist, { graduation: [] }, "nothing written since the start: no plugin's guidance");
        assert.doesNotMatch((await agent.call("land", { capability: capability.id })).text, /Next:/);
        const noted = await agent.call("my_health_note", { words: "steady" });
        assert.equal(noted.isError, false, noted.text);

        const work = (await agent.call("worklist", { memoryFolders: [] })).data.worklist as { rest?: unknown; plugins?: { plugin: string; kinds: string[]; guidance: { title: string }[] }[] };
        assert.equal(work.rest, undefined, "a plugin kind's write makes no core list due");
        assert.deepEqual(work.plugins?.map(({ plugin, kinds, guidance }) => ({ plugin, kinds, guidance: guidance.map((note) => note.title) })),
          [{ plugin: "my-health", kinds: ["my-health.reading"], guidance: ["my-health: fold old readings"] }]);
        assert.deepEqual((await agent.call("land", { capability: capability.id })).data.next, ["run the librarian's pass"], "the plugin kind's write prompts the pass");
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("library 26.4 the installed server enables the librarian for storytree's own library first", async () => {
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

/** Wait until the clock has moved past now, so what is written next has a later millisecond timestamp. */
async function clockMovesOn(): Promise<void> {
  const now = Date.now();
  await waitUntil(() => Date.now() > now, 5_000, "the clock to move on");
}
