/**
 * Capability 6 · Agent tools (the MCP server), in the agent link story: listing the tools, planning, claiming and reporting through them, cancelling a call, landing, and wiring a pipeline. One of three files
 * (agent-tools, agent-tools-reads, agent-tools-writes) split so a test unit runs them side by side.
 * A test client talks to the server inside the test itself, over an
 * in-memory transport, with no real agent and no network, as Claude Code or Codex would: Claude
 * Code's session id reaches the server in its environment, Codex's on each call's `_meta`, and each
 * call's `_meta` carries its id as that harness sends it.
 *
 * The server works in a throwaway folder set up as a project (named with uniqueProjectName(), its
 * library dropped afterwards), and finds storytree from the test Postgres's own owner record.
 * What the tests check is read back through the library and the activity log themselves.
 */
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { connect } from "@storytree/library";
import pg from "pg";
import { z } from "zod";

import { readClaims } from "@storytree/agent-link";
import { sessionsFrom } from "@storytree/agent-link/readings";
import { claudeCode, codex, idOf, withAgent } from "../testing/agent.js";
import { git } from "@storytree/agent-link/testing/folders";
import { projectDatabase, testServerDataDir, testServerUrl } from "@storytree/agent-link/testing/pg";
import { createAgentTools, type ToolExtension } from "../index.js";
import { protectionThrough, storytreeRef } from "@storytree/app-setup/pipeline";
import { registerPlanTools } from "./plan-tools.js";
import type { Call, Define } from "./server.js";
import { FOUNDED, planned, TOOLS, withProject } from "../testing/tool-world.js";

test("map 3.5: focus serves the current project with counts, dry_run, show and a complete-or-refused ceiling", async () => {
  await withProject(async ({ folder, library }) => {
    const story = await library.addStory({ title: "The app" });
    const cap = await library.addCapability({ story: story.id, title: "2 · Projects" });
    const promise = await library.addContract({ capability: cap.id, title: "2.5 · An empty project shows its next step" });
    const src = path.join(folder, "packages/app/src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "view.ts"), "export const view = 1;\n");
    writeFileSync(path.join(src, "view.test.ts"), 'import { view } from "./view.js"; test("2.5 empty view", () => view);');
    await withAgent(folder, codex("map-reader"), async (agent) => {
      const select = "file:packages/app/src/view.ts";
      const counts = await agent.call("focus", { select, up: 1 });
      assert.equal(counts.isError, false, counts.text);
      assert.equal(counts.data.mode, "counts");
      assert.equal(counts.data.rowCount, 4);
      assert.equal(counts.data.rows, undefined);
      const dry = await agent.call("focus", { select, up: 1, mode: "dry_run" });
      const shown = await agent.call("focus", { select, up: 1, mode: "show" });
      assert.equal(dry.isError, false, dry.text);
      assert.equal(shown.isError, false, shown.text);
      assert.equal(dry.data.rows, undefined);
      assert.equal(dry.data.estimatedTokens, shown.data.estimatedTokens);
      assert.deepEqual(counts.data.counts, shown.data.counts);
      const rows = shown.data.rows as { id: string }[];
      assert.ok(rows.some(row => row.id === cap.id));
      assert.ok(rows.some(row => row.id === promise.id));
      const filtered = await agent.call("focus", { select: `cap:${cap.id}`, down: 1, kind: ["promise"], mode: "show" });
      assert.deepEqual((filtered.data.rows as { id: string }[]).map(row => row.id), [promise.id]);
      for (const args of [{ select, up: -1 }, { select, mode: "invalid" }, {}]) assert.equal((await agent.call("focus", args)).isError, true);
      await Promise.all(Array.from({ length: 201 }, (_, index) => library.addContract({ capability: cap.id, title: `2.${index + 6} · Promise ${index}` })));
      const refused = await agent.call("focus", { select: `cap:${cap.id}`, down: 1, mode: "show" });
      assert.equal(refused.isError, true);
      assert.equal(refused.data.refused, true);
      assert.equal(refused.data.rows, undefined);
      assert.ok((refused.data.rowCount as number) > 200);
      assert.ok(refused.data.counts);
    });
  });
});

test("6.41 a tool reports each phase as progress the client receives before the answer, and a cancelled call starts no further phase", async () => {
  await withProject(async ({ folder }) => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reachedGate!: () => void;
    const atGate = new Promise<void>((resolve) => { reachedGate = resolve; });
    let ended: (outcome: string) => void = () => undefined;
    const extension: ToolExtension = {
      registerTools(define) {
        define("phased", "Run in phases", z.object({ wait: z.boolean().optional() }), async ({ wait }, call) => {
          try {
            for (const phase of ["graduation", "friction", "catalogue"]) {
              await call.progress(phase);
              started.push(phase);
              if (wait === true && phase === "graduation") { reachedGate(); await gate; }
            }
            ended("finished");
            return { text: "All phases ran." };
          } catch (error) {
            ended("stopped");
            throw error;
          }
        });
      },
    };
    const tools = createAgentTools({ folder, dataDir: testServerDataDir(), env: { CLAUDE_CODE_SESSION_ID: "phased-caller" }, extensions: [extension] });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "claude-code", version: "test" });
    try {
      await tools.server.connect(serverSide);
      await client.connect(clientSide);
      const events: string[] = [];
      const answer = await client.callTool({ name: "phased", arguments: {} }, { onprogress: ({ message }) => { events.push(`progress: ${message}`); } });
      events.push("answer");
      assert.notEqual(answer.isError, true, JSON.stringify(answer.content));
      assert.deepEqual(events, ["progress: graduation", "progress: friction", "progress: catalogue", "answer"]);
      // A client that asked for no progress gets the answer alone.
      const quiet = await client.callTool({ name: "phased", arguments: {} });
      assert.notEqual(quiet.isError, true, JSON.stringify(quiet.content));

      started.length = 0;
      const outcome = new Promise<string>((resolve) => { ended = resolve; });
      const abort = new AbortController();
      const pending = client.callTool({ name: "phased", arguments: { wait: true } }, { signal: abort.signal, onprogress: () => undefined });
      const cancelled = assert.rejects(pending, /cancel/i);
      await atGate;
      abort.abort(new Error("cancel the phased call"));
      await cancelled;
      await client.ping(); // The server has processed the cancellation notice.
      release();
      assert.equal(await outcome, "stopped");
      assert.deepEqual(started, ["graduation"], "no phase starts once the call is cancelled");
    } finally {
      await client.close();
      await tools.close();
    }
  });
});

test("6.20 cancelling an MCP edit queued for the write lock leaves the record and history unchanged", async () => {
  await withProject(async ({ folder, project, library }) => {
    const story = await library.addStory({ title: "Before cancellation" });
    const before = await library.history({ id: story.id });
    const url = new URL(testServerUrl());
    url.pathname = `/${projectDatabase(project)}`;
    const blocker = new pg.Client({ connectionString: url.href });
    const observer = new pg.Client({ connectionString: url.href });
    const openConnections = new Set<pg.Client>();
    for (const connection of [blocker, observer]) {
      connection.once("connect", () => openConnections.add(connection));
      connection.once("end", () => openConnections.delete(connection));
    }
    const tools = createAgentTools({ folder, dataDir: testServerDataDir(), env: { CLAUDE_CODE_SESSION_ID: "cancelled-writer" } });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "claude-code", version: "test" });
    try {
      await blocker.connect();
      await observer.connect();
      await tools.server.connect(serverSide);
      let cancellationReceived = false;
      const receive = serverSide.onmessage!;
      serverSide.onmessage = (message, extra) => {
        if ("method" in message && message.method === "notifications/cancelled") cancellationReceived = true;
        receive(message, extra);
      };
      await client.connect(clientSide);
      await client.callTool({ name: "show_plan", arguments: {} }); // Connect before blocking writes.
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
      const abort = new AbortController();
      const pending = client.callTool({ name: "edit_plan", arguments: { id: story.id, title: "Cancelled edit" } }, { signal: abort.signal });
      const cancelled = assert.rejects(pending, /cancel/i);
      // Observe a real queued writer, not a sleep that guesses when it reached the lock.
      const deadline = Date.now() + 10_000;
      while (true) {
        const waiting = await observer.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'");
        if (waiting.rowCount) break;
        assert.ok(Date.now() < deadline, "the MCP edit reached the project's write lock");
        await delay(10);
      }
      assert.deepEqual(await library.get(story.id), story);
      abort.abort(new Error("cancel queued edit"));
      await cancelled;
      await client.ping(); // The server has processed the preceding cancellation notice.
      assert.equal(cancellationReceived, true);
      await blocker.query("COMMIT");
      // This write takes its turn after the queued edit, so the assertion cannot race it.
      await library.addStory({ title: "Following write" });
      assert.deepEqual(await library.get(story.id), story);
      assert.deepEqual(await library.history({ id: story.id }), before);

      const accepted = await client.callTool({ name: "edit_plan", arguments: { id: story.id, title: "Wanted edit" } });
      assert.notEqual(accepted.isError, true);
      assert.deepEqual((await library.get(story.id))?.fields, { title: "Wanted edit" });
      assert.equal((await library.history({ id: story.id })).at(-1)?.actor, "session:cancelled-writer");
    } finally {
      // Client.end waits for the socket to close (and releases any held lock). Pool.end
      // returns before idle sockets close, so DROP DATABASE ... FORCE could overtake them.
      await Promise.all([blocker.end(), observer.end()]);
      await client.close();
      await tools.close();
      assert.equal(openConnections.size, 0, "test connections have ended before the project is force-dropped");
    }
  });
});

// 5.15 / 6.21: exercise library admission through real MCP calls.
for (const scenario of [
  { tool: "claim", boundary: "library" },
  { tool: "make_workspace", boundary: "library" },
  { tool: "attach_workspace", boundary: "library" },
  { tool: "claim", boundary: "admitted" },
  { tool: "make_workspace", boundary: "admitted" },
  { tool: "attach_workspace", boundary: "admitted" },
] as const) {
  test(`6.21 cancelling ${scenario.tool} at ${scenario.boundary} ${scenario.boundary === "admitted" ? "completes the admitted claim" : "leaves no claim, activation or workspace change"}`, async () => {
    await withProject(async ({ folder, project, library, log }) => {
      const { tool, boundary } = scenario;
      const arc = await library.createArc({ title: "Cancellation", intent: "Claim only wanted work", endState: "No abandoned claim" });
      const increment = await library.addIncrement({ arc: arc.id, title: "Queued work", objective: "Build", body: "Red then green" });
      const id = increment.id;
      const before = await library.get(id);
      const history = await library.history({ id });
      const origin = path.join(path.dirname(folder), "origin.git");
      git(path.dirname(folder), "init", "--bare", "-b", "main", origin);
      git(folder, "init", "-b", "main");
      git(folder, "add", ".");
      git(folder, "commit", "-m", "first");
      git(folder, "remote", "add", "origin", origin);
      git(folder, "push", "origin", "main");
      const ref = git(folder, "rev-parse", "HEAD").trim();
      const appFolder = path.join(path.dirname(folder), "app worktree");
      if (tool === "attach_workspace") git(folder, "worktree", "add", "--detach", appFolder, ref);
      const worktrees = git(folder, "worktree", "list", "--porcelain");
      const branches = git(folder, "for-each-ref", "refs/heads");
      const url = new URL(testServerUrl());
      url.pathname = `/${projectDatabase(project)}`;
      const blocker = new pg.Client({ connectionString: url.href });
      const observer = new pg.Client({ connectionString: url.href });
      const openConnections = new Set<pg.Client>();
      for (const connection of [blocker, observer]) {
        connection.once("connect", () => openConnections.add(connection));
        connection.once("end", () => openConnections.delete(connection));
      }
      const session = "cancelled-claimant";
      const isCodex = tool === "attach_workspace";
      const meta = isCodex ? { sessionId: session, threadId: session } : {};
      const tools = createAgentTools({ folder, dataDir: testServerDataDir(), env: isCodex ? {} : { CLAUDE_CODE_SESSION_ID: session } });
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: isCodex ? "codex-mcp-client" : "claude-code", version: "test" });
      try {
        await blocker.connect();
        await observer.connect();
        await tools.server.connect(serverSide);
        let cancellationReceived = false;
        const receive = serverSide.onmessage!;
        serverSide.onmessage = (message, extra) => {
          if ("method" in message && message.method === "notifications/cancelled") cancellationReceived = true;
          receive(message, extra);
        };
        await client.connect(clientSide);
        await client.callTool({ name: "show_plan", arguments: {}, _meta: meta });
        await blocker.query("BEGIN");
        if (boundary === "library") {
          await blocker.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
        } else {
          // A row lock blocks activation AFTER the library admits it through the advisory lock.
          await blocker.query("SELECT id FROM record WHERE id = $1 FOR UPDATE", [id]);
        }
        const abort = new AbortController();
        const pending = client.callTool({
          name: tool,
          arguments: {
            increment: id, reason: "Build queued work",
            ...(isCodex ? { folder: appFolder, ref, name: "queued-work" } : {}),
          },
          _meta: meta,
        }, { signal: abort.signal });
        const cancelled = assert.rejects(pending, /cancel/i);
        const deadline = Date.now() + 10_000;
        while (true) {
          const waiting = await observer.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = $1", [boundary === "admitted" ? "transactionid" : "advisory"]);
          if (waiting.rowCount) break;
          assert.ok(Date.now() < deadline, `${tool} reached the ${boundary} lock`);
          await delay(10);
        }
        abort.abort(new Error("cancel claim"));
        await cancelled;
        await client.ping();
        assert.equal(cancellationReceived, true);
        await blocker.query("COMMIT");
        // Drain the library writer, then the claim's log transaction, before observing effects.
        await library.addStory({ title: "Following write" });
        await log.locked(project, async () => {});
        await client.callTool({ name: "show_plan", arguments: {}, _meta: meta });
        const claimed = (await log.since(project, 0)).lines.filter((line) => line.kind === "claimed");
        if (boundary !== "admitted") {
          assert.deepEqual(await library.get(id), before);
          assert.deepEqual(await library.history({ id }), history);
          assert.deepEqual(claimed, [], "cancellation leaves no claimed line, including a released claim");
          assert.deepEqual(await readClaims(log, project), []);
          assert.equal(git(folder, "worktree", "list", "--porcelain"), worktrees);
          assert.equal(git(folder, "for-each-ref", "refs/heads"), branches);
        } else {
          const active = await library.get(id);
          assert.ok(active?.type === "increment");
          assert.equal(active.fields.status, "active");
          const after = await library.history({ id });
          assert.equal(after.length, history.length + 1);
          assert.equal(after.at(-1)?.actor, `session:${session}`);
          assert.equal(claimed.length, 1);
          const [held] = await readClaims(log, project);
          assert.equal(held?.session, session);
          assert.equal(held?.increment, id);
          if (tool === "make_workspace") {
            assert.ok(held?.branch);
            assert.ok(git(folder, "worktree", "list", "--porcelain").includes(`branch refs/heads/${held.branch}`));
          } else if (isCodex) {
            assert.equal(git(appFolder, "branch", "--show-current").trim(), "codex/queued-work");
          }
        }
      } finally {
        // Client.end waits for the socket to close (and releases any held lock). Pool.end
        // returns before idle sockets close, so DROP DATABASE ... FORCE could overtake them.
        await Promise.all([blocker.end(), observer.end()]);
        await client.close();
        await tools.close();
        assert.equal(openConnections.size, 0, "test connections have ended before the project is force-dropped");
      }
    });
  });
}

test("6.1 a test client lists the tools, then plans an arc, a story, a capability and a contract, which appear in the library's tree, the story and the capability each with its founding decision first on its shelf, and it can correct each of them", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      assert.deepEqual(await agent.tools(), TOOLS);

      const story = idOf(await agent.call("plan_story", { title: "Visitor can sign up", founding: { title: "Email only, no social login", text: "The smallest signup that works" } }));
      const arc = idOf(await agent.call("plan_arc", { title: "Launch v1", intent: "Ship sign-up", end_state: "Visitors can sign up", stories: [story] }));
      const capability = idOf(await agent.call("plan_capability", { story, title: "Email form", founding: { title: "Validate on the client first", text: "Before any request is sent" } }));
      const contract = idOf(await agent.call("plan_contract", { capability, title: "Rejects a bad email" }));

      const planned = await library.projectTree();
      assert.deepEqual(planned.stories.map((node) => [node.id, node.title]), [[story, "Visitor can sign up"]]);
      assert.deepEqual(planned.stories[0]?.capabilities.map((node) => [node.id, node.title]), [[capability, "1 · Email form"]]);
      assert.deepEqual(planned.stories[0]?.capabilities[0]?.contracts.map((node) => [node.id, node.title]), [[contract, "1.1 · Rejects a bad email"]], "the first contract of a capability planned moments before is numbered");
      assert.deepEqual(planned.arcs.map((node) => [node.id, node.title, node.stories]), [[arc, "Launch v1", [story]]]);
      // Each story and capability is born with its founding decision, the first book on its shelf.
      const spines = async (node: string) => (await library.frontCovers(node)).map((cover) => [cover.fields.title, cover.fields.text]);
      assert.deepEqual(await spines(story), [["Email only, no social login", "The smallest signup that works"]]);
      assert.deepEqual(await spines(capability), [["Validate on the client first", "Before any request is sent"]]);

      for (const [id, title] of [
        [story, "Visitor can sign up with email"],
        [arc, "Launch v1.0"],
        [capability, "Signup form"],
        [contract, "Rejects an email with no @"],
      ] as const) {
        assert.equal(idOf(await agent.call("edit_plan", { id, title })), id);
      }
      const corrected = await library.projectTree();
      assert.equal(corrected.stories[0]?.title, "Visitor can sign up with email");
      assert.equal(corrected.arcs[0]?.title, "Launch v1.0");
      assert.equal(corrected.stories[0]?.capabilities[0]?.title, "Signup form");
      assert.equal(corrected.stories[0]?.capabilities[0]?.contracts[0]?.title, "Rejects an email with no @");
    });
  });
});

test("6.32 name_session names the calling session, and calling it again renames it; a title longer than 40 characters is refused naming the limit", async () => {
  await withProject(async ({ folder, project, log }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const name = async () => sessionsFrom((await log.since(project, 0)).lines).find((one) => one.session === "claude-1")?.name;
      assert.equal((await agent.call("name_session", { title: "Reading the plan" })).isError, false);
      assert.equal(await name(), "Reading the plan");
      await agent.call("name_session", { title: "Building signup" });
      assert.equal(await name(), "Building signup", "the latest call wins");
      const tooLong = await agent.call("name_session", { title: "x".repeat(41) });
      assert.equal(tooLong.isError, true);
      assert.match(tooLong.text, /40/);
      assert.equal(await name(), "Building signup");
    });
  });
});

test("6.2 it claims the capability, sees who is on what, reports the contract red then green (reported moves from failing to passing, verified stays not checked), and reports it landed, which ends the claim", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Visitor can sign up", ...FOUNDED }));
      const capability = idOf(await agent.call("plan_capability", { story, title: "Email form", ...FOUNDED }));
      const contract = idOf(await agent.call("plan_contract", { capability, title: "Rejects a bad email" }));

      const claimed = await agent.call("claim", { capability, reason: "building the email form" });
      assert.equal(claimed.isError, false, claimed.text);
      const arc = idOf(await agent.call("plan_arc", { title: "Launch", intent: "Ship signup", end_state: "Visitors join" }));
      const increment = idOf(await agent.call("park_increment", { arc, title: "Signup release", objective: "Ship the form", body: "Red then green" }));
      assert.equal((await agent.call("claim", { increment, reason: "driving the signup release" })).isError, false);
      const plan = await agent.call("show_plan");
      assert.deepEqual(
        (plan.data.claims as { capability?: string; increment?: string; session: string; label: string; reason: string }[]).map(({ capability, increment, session, label, reason }) => ({
          held: capability ?? increment,
          session,
          label,
          reason,
        })),
        [
          { held: capability, session: "claude-1", label: "Claude Code", reason: "building the email form" },
          { held: increment, session: "claude-1", label: "Claude Code", reason: "driving the signup release" },
        ],
      );
      assert.ok(plan.text.split("\n").some((line) => line.includes(increment) && line.includes("Signup release") && line.includes("Claude Code claude-1") && line.includes("driving the signup release")), plan.text);
      assert.deepEqual((plan.data.sessions as { session: string; state: string }[]).map(({ session, state }) => ({ session, state })), [
        { session: "claude-1", state: "working" },
      ]);

      assert.equal((await agent.call("report", { contract, result: "red" })).isError, false);
      assert.deepEqual(await library.health(contract).then(({ reported, verified }) => [reported.state, verified.state]), ["failing", "not-checked"]);
      assert.equal((await agent.call("report", { contract, result: "green" })).isError, false);
      assert.deepEqual(await library.health(contract).then(({ reported, verified }) => [reported.state, verified.state]), ["passing", "not-checked"]);

      assert.equal((await agent.call("land", { capability })).isError, false);
      assert.equal((await agent.call("release", { increment })).isError, false);
      assert.deepEqual(await readClaims(log, project), [], "landing ended the claim");
      const landed = (await log.since(project, 0)).lines.filter((line) => line.kind === "landed");
      assert.deepEqual(landed.map((line) => line.session), ["claude-1"]);
    });
  });
});

test("6.37 land refuses while the story's package has a source file no numbered test reaches, naming it, and lands once it is placed (ADR-0911 D4)", async () => {
  await withProject(async ({ folder, project, log }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Shopping cart", ...FOUNDED }));
      const capability = idOf(await agent.call("plan_capability", { story, title: "Adding", ...FOUNDED }));
      const src = path.join(folder, "packages/shopping-cart/src");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(folder, "packages/shopping-cart/package.json"), JSON.stringify({ name: "shopping-cart" }));
      writeFileSync(path.join(src, "cart.js"), "export const add = (a, b) => a + b;\n");
      writeFileSync(path.join(src, "cart.test.js"), 'import { test } from "node:test";\nimport { add } from "./cart.js";\ntest("1.1 adds", () => add(1, 2));\n');
      writeFileSync(path.join(src, "refund.js"), "export const refund = () => 0;\n");
      assert.equal((await agent.call("claim", { capability, reason: "building the cart" })).isError, false);

      const held = await agent.call("land", { capability });
      assert.equal(held.isError, true, held.text);
      assert.match(held.text, /packages\/shopping-cart\/src\/refund\.js/);
      assert.match(held.text, /number a test that reaches it/);
      assert.doesNotMatch(held.text, /cart\.js \(/);
      assert.deepEqual((await log.since(project, 0)).lines.filter((line) => line.kind === "landed"), [], "a held landing records nothing");
      assert.equal((await readClaims(log, project)).length, 1, "the claim stays");

      writeFileSync(path.join(src, "refund.test.js"), 'import { test } from "node:test";\nimport { refund } from "./refund.js";\ntest("1.2 refunds", () => refund());\n');
      const landed = await agent.call("land", { capability });
      assert.equal(landed.isError, false, landed.text);
      assert.deepEqual(await readClaims(log, project), []);
    });
  });
});

test("6.38 land names each planned contract of the capability that no numbered test in its story's package proves, and still lands", async () => {
  await withProject(async ({ folder }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Shopping cart", ...FOUNDED }));
      const capability = idOf(await agent.call("plan_capability", { story, title: "Adding", ...FOUNDED }));
      idOf(await agent.call("plan_contract", { capability, title: "Adds an item" }));
      idOf(await agent.call("plan_contract", { capability, title: "Refuses a sold-out item" }));
      const src = path.join(folder, "packages/shopping-cart/src");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(folder, "packages/shopping-cart/package.json"), JSON.stringify({ name: "shopping-cart" }));
      writeFileSync(path.join(src, "cart.js"), "export const add = (a, b) => a + b;\n");
      writeFileSync(path.join(src, "cart.test.js"), 'import { test } from "node:test";\nimport { add } from "./cart.js";\ntest("1.1 adds", () => add(1, 2));\n');
      assert.equal((await agent.call("claim", { capability, reason: "building the cart" })).isError, false);

      const landed = await agent.call("land", { capability });
      assert.equal(landed.isError, false, landed.text);
      assert.match(landed.text, /1\.2 · Refuses a sold-out item/);
      assert.doesNotMatch(landed.text, /1\.1 · Adds an item/);
      assert.deepEqual(landed.data.untested, ["1.2 · Refuses a sold-out item"]);
    });
  });
});

test("6.50 plan_contract numbers a new contract past the numbers its capability's landed tests already carry, naming those no contract carries", async () => {
  await withProject(async ({ folder }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Shopping cart", ...FOUNDED }));
      const capability = idOf(await agent.call("plan_capability", { story, title: "Adding", ...FOUNDED }));
      const src = path.join(folder, "packages/shopping-cart/src");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(folder, "packages/shopping-cart/package.json"), JSON.stringify({ name: "shopping-cart" }));
      writeFileSync(path.join(src, "cart.test.js"), 'import { test } from "node:test";\ntest("1.1 adds", () => {});\ntest("1.3 refuses a sold-out item", () => {});\n');

      const planned = await agent.call("plan_contract", { capability, title: "Removes an item" });
      assert.equal(planned.isError, false, planned.text);
      assert.match(planned.text, /1\.4 · Removes an item/);
      assert.match(planned.text, /Numbered tests 1\.1 and 1\.3 have no contract/, "the orphan tests are named, so the planner can choose one's number");
      assert.deepEqual(planned.data.orphans, ["1.1", "1.3"]);
      const kept = await agent.call("plan_contract", { capability, title: "1.1 · Adds an item" });
      assert.match(kept.text, /1\.1 · Adds an item/, "a landed test's own number is kept, so its contract can be planned");
    });
  });
});

test("agent-link 11.1 on GitHub, wire_pipeline writes storytree's workflow: the project's install and tests on each system chosen, and storytree check pinned to this storytree's release", async () => {
  await withProject(async ({ folder }) => {
    git(folder, "init", "-q");
    git(folder, "remote", "add", "origin", "https://github.com/someone/shop.git");
    await withAgent(folder, claudeCode("claude-1", { protection: async () => "allowed" }), async (agent) => {
      const wired = await agent.call("wire_pipeline", { install: "npm ci", test: "npm test -- --grep \"a: b\"", systems: ["linux", "windows"] });
      assert.equal(wired.isError, false, wired.text);
      const workflow = readFileSync(path.join(folder, ".github/workflows/storytree.yml"), "utf8");
      assert.match(workflow, /on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]/);
      assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
      assert.ok(workflow.includes('- run: "npm ci"\n      - run: "npm test -- --grep \\"a: b\\""'), workflow);
      assert.ok(workflow.includes(`--branch ${storytreeRef()} https://github.com/storytree-ai/storytree.git`), workflow);
      assert.match(workflow, /pnpm install --frozen-lockfile --prod --ignore-scripts --filter-prod "@storytree\/guardrails\.\.\."/);
      assert.match(workflow, /node --import tsx src\/check\/run\.ts "\$GITHUB_WORKSPACE"/);
      assert.match(wired.text, /\.github\/workflows\/storytree\.yml/);
    });
  });
});

test("agent-link 11.2 in a project not on GitHub, wire_pipeline writes nothing and gives the commands to add to the user's own pipeline", async () => {
  await withProject(async ({ folder }) => {
    git(folder, "init", "-q");
    git(folder, "remote", "add", "origin", "https://gitlab.com/someone/shop.git");
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const wired = await agent.call("wire_pipeline", { test: "npm test" });
      assert.equal(wired.isError, false, wired.text);
      assert.equal(existsSync(path.join(folder, ".github")), false, "nothing is written");
      assert.match(wired.text, /npm test/);
      assert.match(wired.text, /src\/check\/run\.ts/);
      assert.match(wired.text, /the pipeline you have/);
    });
  });
});

test("agent-link 11.3 wire_pipeline proposes branch protection as a command for the user to approve, and changes no repository setting itself", async () => {
  await withProject(async ({ folder }) => {
    git(folder, "init", "-q");
    git(folder, "remote", "add", "origin", "git@github.com:someone/shop.git");
    // A gh that answers the protection read as GitHub does for a repository that can have protection and has none.
    const gh = path.join(folder, "gh.mjs");
    writeFileSync(gh, `console.log(${JSON.stringify(JSON.stringify({ message: "Branch not protected", status: "404" }))});\nprocess.exit(1);\n`);
    await withAgent(folder, claudeCode("claude-1", { protection: protectionThrough(process.execPath, [gh]) }), async (agent) => {
      const wired = await agent.call("wire_pipeline", { test: "npm test" });
      assert.match(wired.text, /gh api -X PUT repos\/someone\/shop\/branches\/main\/protection/);
      assert.match(wired.text, /"contexts":\["test \(ubuntu-latest\)","storytree check"\]/);
      assert.match(wired.text, /only if the user approves/);
      assert.equal((wired.data.protection as { approved: boolean }).approved, false);
    });
  });
});

test("agent-link 11.5 when GitHub refuses protection on the repository's plan (a free private repository), wire_pipeline offers merging only after both checks pass instead of a command that would fail, and only reads the setting", async () => {
  await withProject(async ({ folder }) => {
    git(folder, "init", "-q");
    git(folder, "remote", "add", "origin", "https://github.com/someone/shop.git");
    // A gh that answers the protection read as GitHub answered shop3 (2026-10-05), noting every call it is asked.
    const gh = path.join(folder, "gh.mjs");
    const calls = path.join(folder, "gh-calls.txt");
    const refused = { message: "Upgrade to GitHub Pro or make this repository public to enable this feature.", status: "403" };
    writeFileSync(gh, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(" ") + "\\n");\nconsole.log(${JSON.stringify(JSON.stringify(refused))});\nprocess.exit(1);\n`);
    await withAgent(folder, claudeCode("claude-1", { protection: protectionThrough(process.execPath, [gh]) }), async (agent) => {
      const wired = await agent.call("wire_pipeline", { test: "npm test" });
      assert.equal(wired.isError, false, wired.text);
      assert.doesNotMatch(wired.text, /-X PUT/);
      assert.match(wired.text, /cannot have branch protection/);
      assert.match(wired.text, /merge only after both checks pass/);
      assert.match(wired.text, /GitHub Pro|public/);
      assert.deepEqual(wired.data.protection, { approved: false, available: false });
      assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"), ["api repos/someone/shop/branches/main/protection"], "it only read the setting");
    });
  });
});

test("6.2 show_plan reads every arc's increments in one ask, however many arcs the project has (ADR-0836 D3)", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    for (const title of ["Launch", "Relaunch", "Sunset"]) {
      const arc = await library.createArc({ title, intent: "Ship signup", endState: "Visitors join" });
      await library.addIncrement({ arc: arc.id, title: `${title} release`, objective: "Ship the form", body: "Red then green" });
    }
    const acts = new Map<string, (args: never, call: Call) => Promise<{ text: string }>>();
    registerPlanTools(((name, _description, _input, act) => acts.set(name, act as never)) as Define);
    const asked = { arcView: 0, arcViews: 0 };
    const counted = new Proxy(library, {
      get(target, key) {
        if (key === "arcView" || key === "arcViews") asked[key]++;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const call = { library: counted, log, project, folder, caller: { session: "claude-1" }, writer: {}, quietMs: 60_000, agent: "orchestrator" } as Call;
    const plan = await acts.get("show_plan")!({} as never, call);
    for (const title of ["Launch", "Relaunch", "Sunset"]) assert.ok(plan.text.includes(`"${title} release"`), plan.text);
    assert.deepEqual(asked, { arcView: 0, arcViews: 1 });
  });
});
