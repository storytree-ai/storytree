/**
 * Capability 6 · Agent tools (the MCP server): contracts 6.1-6.21 in
 * the agent link story. A test client talks to the server inside the test itself, over an
 * in-memory transport, with no real agent and no network, as Claude Code or Codex would: Claude
 * Code's session id reaches the server in its environment, Codex's on each call's `_meta`, and each
 * call's `_meta` carries its id as that harness sends it.
 *
 * The server works in a throwaway folder set up as a project (named with uniqueProjectName(), its
 * library dropped afterwards), and finds storytree from the test Postgres's own owner record.
 * What the tests check is read back through the library and the activity log themselves.
 */
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { createServer, connect as openSocket, type AddressInfo, type Socket } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { connect, type Library } from "@storytree/library";
import { roundDue, worklist } from "@storytree/librarian";
import pg from "pg";
import { z } from "zod";

import { openActivityLog, type ActivityLog, type Line } from "../activity/index.js";
import { recordFriction, reinforceFriction, type ToolExtension } from "../index.js";
import { readClaims } from "../claims/index.js";
import { sessionsFrom } from "../readings.js";
import { MARKER_FILE } from "../routing/index.js";
import { claudeCode, codex, idOf, withAgent, type Agent } from "../testing/agent.js";
import { git, withTempDir } from "../testing/folders.js";
import { dropTestProjects, projectDatabase, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { createAgentTools, NOT_RUNNING_ANSWER } from "./index.js";

/** The toolbox: every tool the server offers. */
const TOOLS = [
  "attach_workspace",
  "check_setup",
  "claim",
  "clear_own_runs",
  "clear_wait",
  "close_increment",
  "close_out",
  "correct_note",
  "correct_question",
  "edit_plan",
  "health_worklist",
  "land",
  "list_all_runs",
  "list_own_runs",
  "make_workspace",
  "mark_built",
  "move_increment",
  "name_session",
  "open",
  "park_arc",
  "park_increment",
  "plan_arc",
  "plan_capability",
  "plan_contract",
  "plan_story",
  "raise_question",
  "read_context",
  "ready_increment",
  "record_friction",
  "record_resteer",
  "reinforce",
  "release",
  "report",
  "retire_from_plan",
  "retire_question",
  "search_notes",
  "set_up_project",
  "set_wait",
  "settle_question",
  "show_plan",
  "stop_own_run",
  "write_note",
];

/** A founding decision: every story and capability planned through the tools is born with one (ADR-0627 D5). */
const FOUNDED = { founding: { title: "Email first", text: "Signing up by email is the smallest thing that works" } };

interface World {
  folder: string;
  project: string;
  library: Library;
  log: ActivityLog;
}

/** Run `body` with a throwaway folder set up as a fresh project, and that project's library and log. */
async function withProject(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    const storytree = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      await body({ folder, project, library: await storytree.openProject(project), log });
    } finally {
      try {
        await log.close();
        await storytree.close();
      } finally {
        await dropTestProjects([project]);
      }
    }
  });
}

test("6.20 cancelling an MCP edit queued for the write lock leaves the record and history unchanged", async () => {
  await withProject(async ({ folder, project, library }) => {
    const story = await library.addStory({ title: "Before cancellation" });
    const before = await library.history({ id: story.id });
    const url = new URL(testServerUrl());
    url.pathname = `/${projectDatabase(project)}`;
    const pool = new pg.Pool({ connectionString: url.href });
    const blocker = await pool.connect();
    const tools = createAgentTools({ folder, dataDir: testServerDataDir(), env: { CLAUDE_CODE_SESSION_ID: "cancelled-writer" } });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "claude-code", version: "test" });
    try {
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
        const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'");
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
      await blocker.query("ROLLBACK");
      blocker.release();
      await client.close();
      await tools.close();
      await pool.end();
    }
  });
});

// 5.15 / 6.21: exercise library admission through real MCP calls.
for (const scenario of [
  { tool: "claim", boundary: "library", target: "proposal" },
  { tool: "make_workspace", boundary: "library", target: "ready" },
  { tool: "attach_workspace", boundary: "library", target: "proposal" },
  { tool: "claim", boundary: "admitted", target: "proposal" },
  { tool: "make_workspace", boundary: "admitted", target: "proposal" },
  { tool: "attach_workspace", boundary: "admitted", target: "proposal" },
] as const) {
  test(`6.21 cancelling ${scenario.tool} at ${scenario.boundary} (${scenario.target}) ${scenario.boundary === "admitted" ? "completes the admitted claim" : "leaves no claim, activation or workspace change"}`, async () => {
    await withProject(async ({ folder, project, library, log }) => {
      const { tool, boundary, target } = scenario;
      const arc = await library.createArc({ title: "Cancellation", intent: "Claim only wanted work", endState: "No abandoned claim" });
      const increment = await library.addIncrement({ arc: arc.id, title: "Queued work", objective: "Build", body: "Red then green" });
      if (target === "ready") await library.advanceIncrement(increment.id, target);
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
      assert.deepEqual(planned.stories[0]?.capabilities.map((node) => [node.id, node.title]), [[capability, "Email form"]]);
      assert.deepEqual(planned.stories[0]?.capabilities[0]?.contracts.map((node) => [node.id, node.title]), [[contract, "Rejects a bad email"]]);
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

test("6.3 every call is recorded against the session that made it, using the session id the harness passes, and the machine it ran on", async () => {
  await withProject(async ({ folder, project, log }) => {
    await withAgent(folder, claudeCode("claude-1"), async (claude) => {
      await withAgent(folder, codex("codex-1"), async (codexAgent) => {
        await claude.call("show_plan");
        await codexAgent.call("show_plan");
        // Codex before 0.155 sends only the thread's id, which is its hooks' session id.
        await codexAgent.call("plan_story", { title: "Visitor can sign in", ...FOUNDED }, { threadId: "codex-2" });
      });
    });
    const calls = (await log.since(project, 0)).lines.filter((line): line is Extract<Line, { kind: "tool-called" }> => line.kind === "tool-called");
    assert.deepEqual(
      calls.map(({ session, harness, source, tool, folder: where, machine }) => ({ session, harness, source, tool, where, machine })),
      [
        { session: "claude-1", harness: "claude-code", source: "tool", tool: "show_plan", where: folder, machine: hostname().trim() },
        { session: "codex-1", harness: "codex", source: "tool", tool: "show_plan", where: folder, machine: hostname().trim() },
        { session: "codex-2", harness: "codex", source: "tool", tool: "plan_story", where: folder, machine: hostname().trim() },
      ],
    );
  });
});

test("in a folder whose project was deleted from the library, a tool says so and how to free the folder, and does not make the project again", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    const storytree = await connect({ url: testServerUrl() });
    try {
      await (await storytree.openProject(project)).close();
      await storytree.dropProject(project); // deleted from another computer; this folder still names it
      await withAgent(folder, claudeCode("claude-1"), async (agent) => {
        const plan = await agent.call("show_plan");
        assert.equal(plan.isError, true);
        assert.match(plan.text, /deleted/);
        assert.match(plan.text, /\.storytree\.json/);
      });
      assert.equal((await storytree.listProjects()).includes(project), false, "nothing made again");
    } finally {
      await storytree.close();
      await dropTestProjects([project]);
    }
  });
});

test('6.4 a bad call gets a readable refusal rather than a crash, and with storytree stopped every tool answers "storytree isn\'t running, carry on without it"', async () => {
  await withProject(async ({ folder }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const unknown = await agent.call("claim", { capability: "capability_000000000000", reason: "building it" });
      assert.equal(unknown.isError, true);
      assert.ok(unknown.text.includes("capability_000000000000"), `the refusal names what it refused: ${unknown.text}`);
      const malformed = await agent.call("report", { contract: 42, result: "amber" });
      assert.equal(malformed.isError, true, "arguments of the wrong shape are refused");
      const story = await agent.call("plan_story", { title: "Still answering", ...FOUNDED });
      assert.equal(story.isError, false, "and the server carries on");
    });

    // The same folder with storytree stopped: nowhere the app's owner record would be.
    await withAgent(folder, claudeCode("claude-1", { dataDir: path.join(folder, "..", "stopped", "pgdata") }), async (agent) => {
      const calls: [string, Record<string, unknown>][] = [
        ["plan_arc", { title: "Launch v1", intent: "Ship sign-up", end_state: "Visitors can sign up" }],
        ["plan_story", { title: "Visitor can sign up", ...FOUNDED }],
        ["plan_capability", { story: "story_000000000000", title: "Email form", ...FOUNDED }],
        ["plan_contract", { capability: "capability_000000000000", title: "Rejects a bad email" }],
        ["edit_plan", { id: "story_000000000000", title: "Renamed" }],
        ["show_plan", {}],
        ["health_worklist", {}],
        ["claim", { capability: "capability_000000000000", reason: "building it" }],
        ["release", { capability: "capability_000000000000" }],
        ["make_workspace", { increment: "increment_000000000000", reason: "building it" }],
        ["attach_workspace", { increment: "increment_000000000000", reason: "building it", folder, ref: "a".repeat(40), name: "form" }],
        ["report", { contract: "contract_000000000000", result: "red" }],
        ["land", { capability: "capability_000000000000" }],
        ["search_notes", { query: "mailgun" }],
        ["open", { id: "decision_000000000000" }],
        ["write_note", { kind: "definition", term: "Delivery", meaning: "Mailgun needs a verified domain" }],
        ["correct_note", { id: "memory_000000000000", text: "Mailgun needs a verified sending domain" }],
        ["retire_from_plan", { id: "contract_000000000000", reason: "no longer promised" }],
        ["park_increment", { arc: "arc_000000000000", title: "Email form", objective: "Build it", body: "Red then green" }],
        ["ready_increment", { increment: "increment_000000000000" }],
        ["close_increment", { increment: "increment_000000000000", disposition: "landed", pr: "#1" }],
        ["move_increment", { increment: "increment_000000000000", to: "arc_000000000000", reason: "belongs there" }],
        ["park_arc", { arc: "arc_000000000000", parked: true }],
        ["mark_built", { capability: "capability_000000000000", built: true }],
        ["set_wait", { waiter: "increment_000000000000", on: "increment_000000000001", reason: "it comes first" }],
        ["clear_wait", { waiter: "increment_000000000000", on: "increment_000000000001" }],
        ["record_friction", { title: "Slow", description: "Slow", statement: "Slow", evidence: "`pnpm test` took 9 s", impact: "Slow" }],
        ["reinforce", { friction: "friction_000000000000", evidence: "#81: timed out again" }],
        ["record_resteer", { title: "Redirected", description: "Redirected", doing: "a", redirect: "b", evidence: '"not that"', disposition: "taste", judged_by: "owner" }],
        ["raise_question", { arc: "arc_000000000000", title: "Which mailer?", stakes: "Cost", statement: "Mailgun or SES?", context: "Both work", options: "Mailgun; SES" }],
        ["correct_question", { question: "question_000000000000", title: "Which mailer, Mailgun or SES?" }],
        ["settle_question", { question: "question_000000000000", answer: "Mailgun" }],
        ["retire_question", { question: "question_000000000000", reason: "asked in error" }],
        ["read_context", {}],
        ["close_out", { safe: true, why: "all merged" }],
        ["name_session", { title: "Building signup" }],
      ];
      // Own's offline tools and the setup check's two do not depend on the library.
      const offlineTools = ["check_setup", "set_up_project", "list_all_runs", "list_own_runs", "stop_own_run", "clear_own_runs"];
      assert.deepEqual(calls.map(([tool]) => tool).sort(), TOOLS.filter((tool) => !offlineTools.includes(tool)), "every library tool is tried");
      for (const [tool, args] of calls) {
        const answer = await agent.call(tool, args);
        assert.deepEqual({ text: answer.text, isError: answer.isError }, { text: NOT_RUNNING_ANSWER, isError: false }, tool);
      }
    });
  });
});

test("6.4 show_plan gives up on a stalled handshake within three seconds and a later call recovers", async (t) => {
  const upstream = new URL(testServerUrl());
  const held = new Set<Socket>();
  let stalled = true;
  const silent = createServer((socket) => {
    held.add(socket);
    socket.on("error", () => {});
    if (stalled) {
      socket.resume();
      setTimeout(() => socket.destroy(), 10_000).unref();
    } else {
      const target = openSocket(Number(upstream.port), upstream.hostname);
      held.add(target);
      target.on("error", () => socket.destroy());
      socket.on("close", () => target.destroy());
      socket.pipe(target).pipe(socket);
    }
  });
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  try {
    await withProject(async ({ folder }) => {
      const dataDir = path.join(folder, "pgdata");
      writeFileSync(`${dataDir}.owner.json`, JSON.stringify({ pid: process.pid, port: (silent.address() as AddressInfo).port, token: "stalled-db", owner: "test", startedAt: new Date().toISOString() }));
      await withAgent(folder, claudeCode("stalled-db", { dataDir }), async (agent) => {
        const started = performance.now();
        const answer = await agent.call("show_plan");
        const waited = performance.now() - started;
        t.diagnostic(`show_plan answered after ${waited.toFixed(0)} ms: ${answer.text}`);
        assert.ok(waited >= 2_500 && waited < 4_000, `the 3 s deadline plus scheduling allowance, got ${waited.toFixed(0)} ms`);
        assert.match(answer.text, /storytree isn't reachable/i);
        assert.match(answer.text, /check.*app.*try again/i);
        stalled = false;
        const recovered = await agent.call("show_plan");
        assert.equal(recovered.isError, false, recovered.text);
        assert.ok(Array.isArray(recovered.data.stories), `the same tool server returns the plan: ${recovered.text}`);
      });
    });
  } finally {
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  }
});

test("6.5 a note written with no place named while holding a claim goes onto that capability's shelf (ADR-0627 D4), and one written with no claim gets no default place", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Visitor can sign up", ...FOUNDED }));
      const form = idOf(await agent.call("plan_capability", { story, title: "Email form", founding: { title: "Send through Mailgun", text: "Its API is the simplest" } }));
      const [founding] = (await library.frontCovers(form)).map((cover) => cover.id);
      assert.ok(founding !== undefined, "the capability is born with its founding decision on its shelf");

      // No claim: no default place.
      const loose = idOf(await agent.call("write_note", { kind: "definition", term: "Delivery", meaning: "Written before any claim" }));
      assert.deepEqual((await noteFields(library, loose)).links, undefined);

      await agent.call("claim", { capability: form, reason: "building the email form" });
      const arc = idOf(await agent.call("plan_arc", { title: "Launch", intent: "Ship signup", end_state: "Visitors join" }));
      const increment = idOf(await agent.call("park_increment", { arc, title: "Signup release", objective: "Ship the form", body: "Red then green" }));
      assert.equal((await agent.call("claim", { increment, reason: "driving the release too" })).isError, false);
      // A memory, with no cover opened yet this session, goes inside the shelf's first book: its founding decision.
      const first = idOf(await agent.call("write_note", { kind: "definition", term: "Delivery", meaning: "Mailgun needs a verified domain" }));
      // A new decision becomes another front cover of the claimed capability; once this session has opened it, a new memory goes inside that one.
      const second = idOf(await agent.call("write_note", { kind: "decision", title: "Validate on the client first", text: "Before any request" }));
      await agent.call("open", { id: second });
      const latest = idOf(await agent.call("write_note", { kind: "definition", term: "Bounce", meaning: "An email that could not be delivered" }));
      // A place the agent names itself always wins.
      const named = idOf(await agent.call("write_note", { kind: "definition", term: "Delivery", meaning: "Filed where I say", links: [founding] }));

      assert.deepEqual((await library.frontCovers(form)).map((cover) => cover.id), [founding, second]);
      assert.deepEqual((await noteFields(library, first)).links, [founding]);
      assert.deepEqual((await noteFields(library, latest)).links, [second]);
      assert.deepEqual((await noteFields(library, named)).links, [founding]);

      // Holding a capability whose shelf is empty, as one made through the library itself can be: nothing is added, and the agent is told.
      const link = (await library.addCapability({ title: "Confirmation link", story })).id;
      await agent.call("claim", { capability: link, reason: "building the confirmation link" });
      const unshelved = await agent.call("write_note", { kind: "definition", term: "Delivery", meaning: "Links expire after a day" });
      assert.equal(unshelved.isError, false);
      assert.deepEqual((await noteFields(library, idOf(unshelved))).links, undefined);
      assert.equal(unshelved.data.shelf, "empty", "the answer says the shelf is empty");
    });
  });
});

test("the sentence travels with the data: a harness that shows the agent a tool's data instead of its text, as Claude Code 2.1.212 did, still shows the sentence (regression: the agent link's live check, 2026-09-26)", async () => {
  await withProject(async ({ folder }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const story = await agent.call("plan_story", { title: "Visitor can sign up", ...FOUNDED });
      const refused = await agent.call("claim", { capability: "capability_000000000000", reason: "building it" });
      const plan = await agent.call("show_plan");
      for (const [tool, answer] of [["plan_story", story], ["claim", refused], ["show_plan", plan]] as const) {
        assert.equal(answer.data.message, answer.text, `${tool}'s data carries its sentence`);
      }
    });
  });
});

test("6.6 searching and opening a note leaves a log line saying which session read it, how it was found (search, link, id or shelf) and whether it took a peek or the whole note", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    const story = await library.addStory({ title: "Visitor can sign up" });
    const form = await library.addCapability({ title: "Email form", story: story.id });
    const cover = await library.recordDecision({ status: "accepted", title: "Send through Mailgun", text: "Its API is the simplest", frontCoverOf: form.id });
    const inside = await library.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain", links: [cover.id] });
    const other = await library.defineTerm({ term: "Delivery", meaning: "Bounces arrive by webhook" });
    const unrelated = await library.defineTerm({ term: "Double opt-in", meaning: "Confirming a signup by email" });

    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const before = (await log.since(project, 0)).cursor;
      await agent.call("search_notes", { query: "bounces" }); // a peek at `other`, found by search
      await agent.call("open", { id: other.id }); // opened from the search
      await agent.call("open", { id: form.id }); // the capability's shelf: a peek at its cover
      await agent.call("open", { id: cover.id }); // opened from the shelf, showing what links in: `inside`
      await agent.call("open", { id: inside.id }); // opened from that link, showing what it links to: the cover
      await agent.call("open", { id: unrelated.id }); // never shown: opened by id

      const reads = (await log.since(project, before)).lines.filter((line): line is Extract<Line, { kind: "note-read" }> => line.kind === "note-read");
      assert.deepEqual(
        reads.map(({ session, note, found, read }) => ({ session, note, found, read })),
        [
          { session: "claude-1", note: other.id, found: "search", read: "peek" },
          { session: "claude-1", note: other.id, found: "search", read: "whole" },
          { session: "claude-1", note: cover.id, found: "shelf", read: "peek" },
          { session: "claude-1", note: cover.id, found: "shelf", read: "whole" },
          { session: "claude-1", note: inside.id, found: "link", read: "peek" },
          { session: "claude-1", note: inside.id, found: "link", read: "whole" },
          { session: "claude-1", note: cover.id, found: "link", read: "peek" },
          { session: "claude-1", note: unrelated.id, found: "id", read: "whole" },
        ],
      );
    });
  });
});

test("6.7 each read names the agent that made it, as the harness revealed it: a subagent by its id, type and task, the orchestrator, or unknown when the harness said nothing", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    const note = await library.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain" });
    // What Claude Code's hooks leave (capability 3): a subagent's start, and who asked for each storytree call, by the call's id.
    const claudeHook = { session: "claude-1", harness: "claude-code", source: "hook", folder } as const;
    await log.append(project, { ...claudeHook, kind: "subagent-started", subagent: "a5b1", type: "Explore", task: "find the mail setup" });
    await log.append(project, { ...claudeHook, kind: "tool-requested", tool: "open", call: "toolu_sub", agent: { subagent: "a5b1", type: "Explore" } });
    await log.append(project, { ...claudeHook, kind: "tool-requested", tool: "open", call: "toolu_main", agent: "orchestrator" });
    // Codex's: a subagent's start. Its calls name their own thread.
    await log.append(project, { session: "codex-1", harness: "codex", source: "hook", folder, kind: "subagent-started", subagent: "thread-2", type: "explorer", task: "Read the mail decision" });
    const before = (await log.since(project, 0)).cursor;

    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      await agent.call("open", { id: note.id }, { "claudecode/toolUseId": "toolu_sub" });
      await agent.call("open", { id: note.id }, { "claudecode/toolUseId": "toolu_main" });
      await agent.call("open", { id: note.id }, { "claudecode/toolUseId": "toolu_no_hook_saw" });
    });
    await withAgent(folder, codex("codex-1"), async (agent) => {
      await agent.call("open", { id: note.id }, { sessionId: "codex-1", threadId: "thread-2", callId: "exec-1" });
      await agent.call("open", { id: note.id }, { sessionId: "codex-1", threadId: "codex-1", callId: "exec-2" });
    });

    const reads = (await log.since(project, before)).lines.filter((line): line is Extract<Line, { kind: "note-read" }> => line.kind === "note-read");
    assert.deepEqual(
      reads.map(({ session, note: read, agent }) => ({ session, read, agent })),
      [
        { session: "claude-1", read: note.id, agent: { subagent: "a5b1", type: "Explore", task: "find the mail setup" } },
        { session: "claude-1", read: note.id, agent: "orchestrator" },
        { session: "claude-1", read: note.id, agent: "unknown" },
        { session: "codex-1", read: note.id, agent: { subagent: "thread-2", type: "explorer", task: "Read the mail decision" } },
        { session: "codex-1", read: note.id, agent: "orchestrator" },
      ],
    );
  });
});

test("6.24 a call a hook saw writes its tool-called and note-read lines naming that hook's tool-requested line as their cause; a call no hook saw names none (ADR-0746 D2)", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    const note = await library.defineTerm({ term: "Delivery", meaning: "Mailgun needs a verified domain" });
    const request = await log.append(project, { session: "claude-1", harness: "claude-code", source: "hook", folder, kind: "tool-requested", tool: "open", call: "toolu_seen", agent: "orchestrator" });

    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      await agent.call("open", { id: note.id }, { "claudecode/toolUseId": "toolu_seen" });
      await agent.call("open", { id: note.id }, { "claudecode/toolUseId": "toolu_no_hook_saw" });
    });

    const written = (await log.since(project, request.seq)).lines.filter((line) => line.kind === "tool-called" || line.kind === "note-read");
    assert.deepEqual(written.map(({ kind, causedBy }) => [kind, causedBy]), [
      ["tool-called", request.seq],
      ["note-read", request.seq],
      ["tool-called", undefined],
      ["note-read", undefined],
    ]);
  });
});

test("6.8 after Claude Code's /clear, which gives the window a new session id the tool server never sees, each call is recorded on the new session its hook named; a call no hook saw keeps the id the server was started with", async () => {
  await withProject(async ({ folder, project, log }) => {
    // check_setup finds storytree through a storytree home: here, one saying where the test Postgres listens.
    const storytreeHome = path.join(folder, "..", "storytree-home");
    mkdirSync(storytreeHome);
    copyFileSync(`${testServerDataDir()}.owner.json`, path.join(storytreeHome, "pgdata.owner.json"));
    const setup = { dataDir: path.join(storytreeHome, "pgdata"), setup: { homes: {}, storytreeHome } };
    // The tool server was started before the /clear: its environment still names the old session.
    await withAgent(folder, claudeCode("claude-before-clear", setup), async (agent) => {
      // The hooks before two calls, as Claude Code runs them after the /clear: they name the new session.
      for (const [call, tool] of [
        ["toolu_plan", "show_plan"],
        ["toolu_check", "check_setup"],
      ] as const) {
        await log.append(project, { session: "claude-after-clear", harness: "claude-code", source: "hook", folder, kind: "tool-requested", tool, call, agent: "orchestrator" });
      }
      await agent.call("show_plan", {}, { "claudecode/toolUseId": "toolu_plan" });
      await agent.call("check_setup", {}, { "claudecode/toolUseId": "toolu_check" });
      await agent.call("show_plan", {}, { "claudecode/toolUseId": "toolu_no_hook_saw" });
    });
    const calls = (await log.since(project, 0)).lines.filter((line): line is Extract<Line, { kind: "tool-called" }> => line.kind === "tool-called");
    assert.deepEqual(
      calls.map(({ tool, session }) => ({ tool, session })),
      [
        { tool: "show_plan", session: "claude-after-clear" },
        { tool: "check_setup", session: "claude-after-clear" },
        { tool: "show_plan", session: "claude-before-clear" },
      ],
    );
  });
});

test("6.22 a test client calls read_context as session S and gets S's reading, worked out at the time of the call, including after S's transcript has grown with no turn ended; after a /clear whose hook named session T, the same call returns T's", async () => {
  await withProject(async ({ folder, project, log }) => {
    const usage = (requestId: string, tokens: number) => `${JSON.stringify({ type: "assistant", requestId, message: { model: "claude-opus-5-5", usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n`;
    const before = path.join(folder, "..", "before-clear.jsonl");
    const after = path.join(folder, "..", "after-clear.jsonl");
    writeFileSync(before, usage("req_1", 180_000));
    writeFileSync(after, usage("req_1", 9_000));
    const hook = { harness: "claude-code", source: "hook", folder } as const;
    await log.append(project, { ...hook, session: "claude-before-clear", kind: "session-started", how: "startup", transcript: before });

    await withAgent(folder, claudeCode("claude-before-clear"), async (agent) => {
      const first = await agent.call("read_context", {});
      assert.equal(first.isError, false);
      assert.deepEqual({ session: first.data.session, tokens: first.data.tokens, source: first.data.source }, { session: "claude-before-clear", tokens: 180_000, source: before });
      assert.match(first.text, /180,000 tokens/);
      assert.deepEqual(first.data.guidance, { value: 600_000, source: "default", position: "under" });
      assert.match(first.text, /under.*600,000.*default/i);

      // The transcript grows mid-turn, with no hook run: the next call reads it as it now stands.
      appendFileSync(before, usage("req_2", 240_000));
      assert.equal((await agent.call("read_context", {})).data.tokens, 240_000);

      // After /clear the window is session T, which only its hooks name; the server still holds S's id.
      await log.append(project, { ...hook, session: "claude-after-clear", kind: "session-started", how: "clear", transcript: after });
      await log.append(project, { ...hook, session: "claude-after-clear", kind: "tool-requested", tool: "read_context", call: "toolu_ctx", agent: "orchestrator", transcript: after });
      const cleared = await agent.call("read_context", {}, { "claudecode/toolUseId": "toolu_ctx" });
      assert.deepEqual({ session: cleared.data.session, tokens: cleared.data.tokens }, { session: "claude-after-clear", tokens: 9_000 });
    });
  });
});

/** A note's fields, as the library holds them. */
async function noteFields(library: Library, id: string): Promise<{ links?: string[] }> {
  const found = (await library.search("")).find((note) => note.id === id);
  assert.ok(found !== undefined, `note ${id} is in the library`);
  return found.fields as { links?: string[] };
}

/** A story, an arc growing it, and a capability, planned through the tools. */
async function planned(agent: Agent) {
  const story = idOf(await agent.call("plan_story", { title: "Visitor can sign up", ...FOUNDED }));
  const arc = idOf(await agent.call("plan_arc", { title: "Launch v1", intent: "Ship sign-up", end_state: "Visitors can sign up", stories: [story] }));
  const capability = idOf(await agent.call("plan_capability", { story, title: "Email form", ...FOUNDED }));
  return { story, arc, capability };
}

test("6.9 it parks an increment, readies it, starts it by claiming it, and closes it landed with its pull request, which ends the claim and closes the arc; it records a landing never parked, parks new work on the closed arc, which re-opens it, and parks and unparks the arc", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc, capability } = await planned(agent);
      const incrementOf = async (id: string) => (await library.arcView(arc))?.increments.find((one) => one.id === id)?.fields;

      const increment = idOf(await agent.call("park_increment", { arc, title: "Email form", objective: "Build the email form", body: "Red then green, contract by contract", touches: [capability] }));
      assert.equal((await incrementOf(increment))?.status, "proposal");
      assert.equal((await agent.call("ready_increment", { increment })).isError, false);
      assert.equal((await incrementOf(increment))?.status, "ready");
      const claimed = await agent.call("claim", { increment, reason: "driving the email form" });
      assert.equal(claimed.isError, false, claimed.text);
      assert.equal((await incrementOf(increment))?.status, "active", "claiming it started it");

      const closed = await agent.call("close_increment", { increment, disposition: "landed", pr: "#12" });
      assert.equal(closed.isError, false, closed.text);
      assert.match(closed.text, /reads closed/);
      assert.equal((await incrementOf(increment))?.outcome?.pr, "#12");
      assert.deepEqual(await readClaims(log, project), [], "closing it ended the claim");
      assert.equal((await library.arcView(arc))?.state, "closed");

      const recorded = idOf(await agent.call("park_increment", { arc, title: "Hotfix", objective: "Fix the typo", body: "Fixed straight away", outcome: { disposition: "landed", pr: "#13" } }));
      assert.equal((await incrementOf(recorded))?.status, "closed", "a landing never parked is born closed");

      const reopening = await agent.call("park_increment", { arc, title: "Welcome email", objective: "Send one", body: "After sign-up" });
      assert.equal(reopening.isError, false, reopening.text);
      assert.match(reopening.text, /re-opens/);
      assert.equal((await library.arcView(arc))?.state, "active");

      assert.equal((await agent.call("park_arc", { arc, parked: true })).isError, false);
      assert.equal((await library.arcView(arc))?.state, "parked");
      assert.equal((await agent.call("park_arc", { arc, parked: false })).isError, false);
      assert.equal((await library.arcView(arc))?.state, "active");
    });
  });
});

test("6.23 mark_built switches a capability's proposed flag off when the agent considers it built, and back on, with the session as its writer; anything but a capability is refused", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { story, capability } = await planned(agent);
      const proposed = async (): Promise<boolean | undefined> => ((await library.get(capability))?.fields as { proposed?: boolean } | undefined)?.proposed;
      assert.equal(await proposed(), true, "planned proposed");

      const built = await agent.call("mark_built", { capability, built: true });
      assert.equal(built.isError, false, built.text);
      assert.match(built.text, /no longer proposed/);
      assert.equal(await proposed(), false);
      assert.equal((await library.history({ id: capability })).at(-1)?.actor, "session:claude-1");

      assert.equal((await agent.call("mark_built", { capability, built: false })).isError, false);
      assert.equal(await proposed(), true);

      const refused = await agent.call("mark_built", { capability: story, built: true });
      assert.match(refused.text, /not a capability/);
    });
  });
});

test("6.29 show_plan gives each capability's word, and for one not healthy its reason, who moves it and the contracts carrying it, in its text and its data", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { capability } = await planned(agent);
      const passing = idOf(await agent.call("plan_contract", { capability, title: "1.1 · Rejects a bad email" }));
      const owner = idOf(await agent.call("plan_contract", { capability, title: "1.2 · Sends through the real mail service" }));
      await library.setProposed(capability, false);
      await library.recordVerified(passing, "passing");
      await library.recordVerified(owner, "not-checked", { skip: "owner" });

      const plan = await agent.call("show_plan");
      const line = plan.text.split("\n").find((each) => each.includes(capability)) ?? "";
      assert.match(line, /untested — needs owner, the owner's to move: 1\.2/, plan.text);
      const shown = (plan.data.stories as { capabilities: { id: string; status: string; why?: { reason: string; mover: string; contracts: string[] } }[] }[])[0]?.capabilities[0];
      assert.equal(shown?.status, "untested");
      assert.deepEqual(shown?.why && { reason: shown.why.reason, mover: shown.why.mover, contracts: shown.why.contracts }, { reason: "needs owner", mover: "owner", contracts: [owner] });
    });
  });
});

test("6.30 health_worklist gives the oldest three capabilities on the health worklist, each with its reason, who moves it, the contracts carrying it and since when, and how many more wait; a capability an open increment touches is not offered", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      assert.match((await agent.call("health_worklist")).text, /nothing waits/i);

      const { arc, capability } = await planned(agent);
      const story = (await library.projectTree()).stories[0]!.id;
      const check = idOf(await agent.call("plan_contract", { capability, title: "1.1 · Rejects a bad email" }));
      await library.setProposed(capability, false);
      await library.recordVerified(check, "failing");
      const later = [];
      for (const title of ["Thank-you page", "Password rules", "Welcome email", "Sign-up button"]) {
        await delay(5);
        later.push(idOf(await agent.call("plan_capability", { story, title, ...FOUNDED })));
      }
      const routed = later[0]!;
      await agent.call("park_increment", { arc, title: "Thank-you page", objective: "Build it", body: "Red then green", touches: [routed] });

      const listed = await agent.call("health_worklist");
      assert.equal(listed.isError, false, listed.text);
      const items = listed.data.items as { capability: string; why: { reason: string; mover: string; contracts: string[] }; since: string }[];
      assert.deepEqual(items.map((item) => item.capability), [capability, later[1], later[2]], "oldest three, the routed one left off");
      assert.deepEqual(items[0]?.why.contracts, [check]);
      assert.equal(listed.data.more, 1);
      assert.match(listed.text, new RegExp(`Email form[^\\n]*unhealthy — failing, the agent's to move[^\\n]*${check}[^\\n]*since \\d{4}-\\d{2}-\\d{2}`));
      assert.match(listed.text, /Password rules[^\n]*proposed — not built, the agent's to move/);
      assert.match(listed.text, /1 more wait/);
      assert.ok(!listed.text.includes(routed), listed.text);
    });
  });
});

test("6.10 it sets a wait with a reason, and a claim on the waiting increment is refused naming it; it clears the wait, and the claim succeeds; a wait that would close a loop gets the library's refusal as a readable answer", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const park = async (title: string) => idOf(await agent.call("park_increment", { arc, title, objective: `Build ${title}`, body: `${title}, red then green` }));
      const form = await park("Email form");
      const confirm = await park("Confirmation email");

      assert.equal((await agent.call("set_wait", { waiter: confirm, on: form, reason: "it sends what the form collects" })).isError, false);
      const refused = await agent.call("claim", { increment: confirm, reason: "driving it" });
      assert.equal(refused.isError, true);
      assert.ok(refused.text.includes(form) && refused.text.includes("it sends what the form collects"), refused.text);

      const loop = await agent.call("set_wait", { waiter: form, on: confirm, reason: "round and round" });
      assert.equal(loop.isError, true);
      assert.match(loop.text, /loop/);

      assert.equal((await agent.call("clear_wait", { waiter: confirm, on: form })).isError, false);
      assert.deepEqual(await library.waitHolds(confirm), []);
      assert.equal((await agent.call("claim", { increment: confirm, reason: "driving it" })).isError, false);
    });
  });
});

test("6.12 friction capture uses the calling folder's branch for the shared daily cap", async () => {
  await withProject(async ({ folder, library }) => {
    git(folder, "init", "-b", "fix/mail");
    const fields = { title: "Delay", description: "Delay", statement: "Timeout", evidence: "src/mail.ts: Error", impact: "Wait" };
    const date = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 2; i++) await library.writeKnowledge("friction", {
      ...fields, provenance: { branch: "fix/mail", date, source: "retro" },
    });
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const third = idOf(await agent.call("record_friction", fields));
      const history = await library.history();
      const fourth = await agent.call("record_friction", fields);
      assert.equal(fourth.isError, true, "the MCP caller shares the cap");
      assert.match(fourth.text, /friction reinforce/);
      assert.deepEqual(await library.history(), history);
      const saved = await library.get(third);
      assert.ok(saved?.type === "friction");
      assert.deepEqual(saved.fields.provenance, { branch: "fix/mail", date, source: "retro" });
    });
  });
});

test("6.12 it records friction with concrete evidence and a re-steer with the owner's quoted words, the agent's account kept apart; vague evidence, a re-steer quoting nobody and a defect with no failure mode are each refused as a readable answer, and nothing is written", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const friction = idOf(
        await agent.call("record_friction", {
          title: "Tests need a running Postgres",
          description: "The suite cannot run without one",
          statement: "Running one test file starts a whole Postgres",
          evidence: "`pnpm test -- src/a.test.ts` took 9 s, most of it in pg_ctl start",
          impact: "Slow red-green loops",
        }),
      );
      const resteer = idOf(
        await agent.call("record_resteer", {
          title: "Asked before building what he had directed",
          description: "A proposal treated as waiting on the owner",
          doing: "Asking the owner whether to build a proposal",
          redirect: "Build what he directed without asking again",
          evidence: "\"proposal means not built yet doesnt mean waiting on me\"",
          self_report: "I read proposal as needing his yes",
          disposition: "defect",
          judged_by: "owner",
          mode: "no-mast-home",
        }),
      );
      assert.ok((await library.search("Postgres")).some((note) => note.id === friction));
      const stored = (await library.search("waiting on me")).find((note) => note.id === resteer)?.fields as { evidence?: string; selfReport?: string } | undefined;
      assert.equal(stored?.evidence, "\"proposal means not built yet doesnt mean waiting on me\"");
      assert.equal(stored?.selfReport, "I read proposal as needing his yes", "the agent's account kept apart");

      const vague = await agent.call("record_friction", { title: "Slowness", description: "Vaguely", statement: "It was slow", evidence: "it was slow and annoying", impact: "annoying" });
      assert.equal(vague.isError, true);
      assert.match(vague.text, /concrete/);
      const unquoted = await agent.call("record_resteer", {
        title: "Vaguely redirected",
        description: "Vaguely",
        doing: "something",
        redirect: "something else",
        evidence: "he wanted it done differently",
        disposition: "taste",
        judged_by: "owner",
      });
      assert.equal(unquoted.isError, true);
      assert.match(unquoted.text, /quote/);
      const modeless = await agent.call("record_resteer", {
        title: "Vaguely wrong",
        description: "Vaguely",
        doing: "something",
        redirect: "something else",
        evidence: "\"not like that\"",
        disposition: "defect",
        judged_by: "agent",
      });
      assert.equal(modeless.isError, true);
      assert.match(modeless.text, /mode/);
      assert.deepEqual(await library.search("Vaguely"), [], "nothing written");
    });
  });
});

test("6.13 it corrects a note's wording in place: the note keeps its id with the new words, only the fields given change, and a note that is not there, or a field its kind does not have, gets a readable refusal", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { capability } = await planned(agent);
      const decision = idOf(await agent.call("write_note", { kind: "decision", title: "Validate on the server", text: "Clients lie", front_cover_of: capability }));
      const memory = idOf(await agent.call("write_note", { kind: "definition", term: "Delivery", meaning: "The form tiemout is 30 s", links: [decision] }));

      assert.equal(idOf(await agent.call("correct_note", { id: memory, meaning: "The form timeout is 30 s" })), memory);
      assert.equal(idOf(await agent.call("correct_note", { id: decision, title: "Validate on the server too" })), decision);
      const [cover] = await library.frontCovers(capability).then((shelf) => shelf.filter((note) => note.id === decision));
      assert.deepEqual([cover?.fields.title, cover?.fields.text], ["Validate on the server too", "Clients lie"], "only the title changed");
      assert.deepEqual((await library.search("timeout")).map((note) => note.id), [memory]);
      assert.deepEqual(await library.search("tiemout"), []);

      const missing = await agent.call("correct_note", { id: "no-such-note", text: "anything" });
      assert.equal(missing.isError, true);
      assert.match(missing.text, /no-such-note/);
      const wrongField = await agent.call("correct_note", { id: memory, title: "A definition has no title" });
      assert.equal(wrongField.isError, true);
      assert.deepEqual(await library.search("has no title"), [], "nothing written");
    });
  });
});

test("6.14 it retires a contract and then a capability with a reason, and each is gone from the plan; an id that is not a capability or a contract gets a readable refusal and nothing is retired", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc, capability } = await planned(agent);
      const kept = idOf(await agent.call("plan_contract", { capability, title: "Rejects a bad email" }));
      const dropped = idOf(await agent.call("plan_contract", { capability, title: "Rejects a long email" }));
      const contractsOf = async () => (await library.projectTree()).stories[0]?.capabilities.find((node) => node.id === capability)?.contracts.map((node) => node.id);

      const retired = await agent.call("retire_from_plan", { id: dropped, reason: "the library caps length already" });
      assert.equal(retired.isError, false, retired.text);
      assert.deepEqual(await contractsOf(), [kept]);
      const { changes } = await library.changesSince(0);
      assert.ok(changes.some((change) => change.recordId === dropped && change.action === "retired"));

      const wrong = await agent.call("retire_from_plan", { id: arc, reason: "not a capability" });
      assert.equal(wrong.isError, true);
      assert.equal((await library.arcView(arc))?.arc.id, arc, "the arc is not retired");

      assert.equal((await agent.call("retire_from_plan", { id: capability, reason: "folded into the sign-up page" })).isError, false);
      assert.deepEqual((await library.projectTree()).stories[0]?.capabilities, []);
    });
  });
});

test("6.11 it raises a question on an arc and holds an increment on it, which a claim then finds waiting on the owner; it settles the question with his answer, which releases the increment, and retiring a question an increment is held on is refused", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const park = async (title: string) => idOf(await agent.call("park_increment", { arc, title, objective: `Build ${title}`, body: `${title}, red then green` }));
      const welcome = await park("Welcome email");
      const asked = { arc, title: "Which mailer?", stakes: "Cost and deliverability", statement: "Send through Mailgun or SES?", context: "Both work here", options: "Mailgun; SES" };
      const question = idOf(await agent.call("raise_question", { ...asked, holds: [welcome] }));
      assert.deepEqual(await library.heldOnQuestion(welcome), [question]);

      const refused = await agent.call("claim", { increment: welcome, reason: "driving it" });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /waiting on the owner/);

      const retired = await agent.call("retire_question", { question, reason: "asked in error" });
      assert.equal(retired.isError, true, "an increment is held on it");
      assert.equal((await library.arcView(arc))?.questions.some((one) => one.id === question), true, "still there");

      const settled = await agent.call("settle_question", { question, answer: "Mailgun: its API is the simplest" });
      assert.equal(settled.isError, false, settled.text);
      assert.equal((await library.arcView(arc))?.questions.find((one) => one.id === question)?.fields.answer, "Mailgun: its API is the simplest");
      assert.deepEqual(await library.heldOnQuestion(welcome), [], "his answer released it");
      assert.equal((await agent.call("claim", { increment: welcome, reason: "driving it" })).isError, false);

      const wrong = idOf(await agent.call("raise_question", { ...asked, title: "Asked in error" }));
      assert.equal((await agent.call("retire_question", { question: wrong, reason: "asked in error" })).isError, false);
      assert.equal((await library.arcView(arc))?.questions.some((one) => one.id === wrong), false, "retired");
    });
  });
});

test("6.15 reinforce appends dated concrete evidence to the existing friction, preserving its route, and refuses invalid recurrences", async () => {
  await withProject(async ({ folder, library }) => {
    const friction = await recordFriction(library, { title: "Slow mail", description: "Mail takes too long", statement: "The mailer timed out", evidence: "src/mail.ts: TimeoutError", impact: "Signup was delayed" });
    await library.editNote(friction.id, { route: "nothing", routeReason: "An upstream outage" });
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      assert.equal(idOf(await agent.call("reinforce", { friction: friction.id, evidence: "#81: mail still times out" })), friction.id);
      const first = await library.get(friction.id);
      assert.ok(first?.type === "friction");
      assert.equal(first.fields.reinforcedBy?.[0]?.date, new Date().toISOString().slice(0, 10));
      assert.equal(first.fields.reinforcedBy?.[0]?.evidence, "#81: mail still times out");
      const second = await reinforceFriction(library, friction.id, { branch: "fix/mail", evidence: "src/mail.ts: TimeoutError again" }, { actor: "person:Sam" });
      assert.equal(second.id, friction.id);
      assert.deepEqual(second.fields, { ...first.fields, reinforcedBy: [
        ...first.fields.reinforcedBy!, { branch: "fix/mail", date: new Date().toISOString().slice(0, 10), evidence: "src/mail.ts: TimeoutError again" },
      ] });
      assert.equal((await library.list("friction")).length, 1, "no twin was created");
      assert.equal((await library.history({ id: friction.id })).at(-1)?.actor, "person:Sam");
      const note = await library.defineTerm({ term: "Delivery", meaning: "Not friction" });
      const before = await library.history();
      for (const [id, evidence] of [[friction.id, "It happened again"], [note.id, "src/mail.ts"], ["missing", "src/mail.ts"]]) {
        await assert.rejects(reinforceFriction(library, id!, { branch: "fix/mail", evidence: evidence! }));
        const refused = await agent.call("reinforce", { friction: id, evidence });
        assert.equal(refused.isError, true, refused.text);
        assert.match(refused.text, /concrete|friction/i);
      }
      assert.deepEqual(await library.history(), before, "refused recurrences wrote nothing");
    });
  });
});

test("6.17 another story registers its tools on this server, sharing routing, the session log and its instructions", async () => {
  await withProject(async ({ folder, library, log, project }) => {
    const decision = await library.recordDecision({ title: "One mailer", text: "Use Mailgun", status: "accepted" });
    const extension: ToolExtension = {
      instructions: "Use `librarian_worklist` to see what needs the librarian's attention.",
      registerTools(define) {
        define("librarian_worklist", "Read the librarian's worklist", z.object({}), async (_args, call) => ({
          text: "The librarian's worklist.", data: { worklist: await worklist(call.library, {}) },
        }));
      },
    };
    await withAgent(folder, claudeCode("librarian-reader", { extensions: [extension] }), async (agent) => {
      assert.deepEqual(await agent.tools(), [...TOOLS, "librarian_worklist"].sort());
      const result = await agent.call("librarian_worklist");
      assert.equal(result.isError, false, result.text);
      assert.deepEqual(result.data.worklist, await worklist(library, {}));
      assert.ok(JSON.stringify(result.data.worklist).includes(decision.id));
      const calls = (await log.since(project, 0)).lines.filter((line) => line.kind === "tool-called");
      assert.deepEqual(calls.map((line) => [line.session, line.kind === "tool-called" && line.tool]), [["librarian-reader", "librarian_worklist"]]);
      const instructions = agent.instructions()!;
      assert.ok(instructions.includes(extension.instructions!));
      assert.deepEqual([...new Set([...instructions.matchAll(/`([^`]+)`/g)].map(([, name]) => name!))].sort(), await agent.tools());
      assert.ok(instructions.split("\n").length <= 60);
    });
  });
});

test("6.18 another story supplies land's next line only when needed; a refused landing asks for none", async () => {
  await withProject(async ({ folder, library }) => {
    const story = await library.addStory({ title: "Signup" });
    const capability = await library.addCapability({ story: story.id, title: "Email form" });
    const { cursor: since } = await library.changesSince(0);
    let calls = 0;
    let unavailable = false;
    const extension: ToolExtension = {
      async landNext(id, call) {
        calls++;
        assert.equal(id, capability.id);
        assert.equal(call.writer.actor, "session:builder");
        if (unavailable) throw new Error("The librarian is unavailable");
        return (await roundDue(call.library, { since })).rest ? "run the librarian's pass" : undefined;
      },
    };
    await withAgent(folder, claudeCode("builder", { extensions: [extension] }), async (agent) => {
      const quiet = await agent.call("land", { capability: capability.id });
      assert.equal(quiet.data.landed, true);
      assert.doesNotMatch(quiet.text, /Next:/);
      await agent.call("write_note", { kind: "definition", term: "Sender", meaning: "The mail domain" });
      const due = await agent.call("land", { capability: capability.id });
      assert.equal(due.data.landed, true);
      assert.ok(due.text.endsWith("Next: run the librarian's pass"), due.text);
      assert.deepEqual(due.data.next, ["run the librarian's pass"]);
      const refused = await agent.call("land", { capability: "missing" });
      assert.equal(refused.isError, true);
      assert.doesNotMatch(refused.text, /Next:/);
      assert.equal(calls, 2, "only successful landings ask for the next step");
      unavailable = true;
      const landed = await agent.call("land", { capability: capability.id });
      assert.equal(landed.isError, false, "a follow-up failure cannot turn a recorded landing into a refusal");
      assert.equal(landed.data.landed, true);
      assert.match(landed.text, /next step.*unavailable/i);
    });
  });
});

test("6.16 every library write from a tool names the calling session, including compound writes, claims, and a session changed by the harness", async () => {
  await withProject(async ({ folder, library, log, project }) => {
    await withAgent(folder, claudeCode("claude-writer"), async (agent) => {
      const write = async (tool: string, args: Record<string, unknown>, count = 1) => {
        const since = (await library.history()).at(-1)?.seq ?? 0;
        const answer = await agent.call(tool, args);
        assert.equal(answer.isError, false, answer.text);
        const history = await library.history({ since });
        assert.equal(history.length, count, `${tool} wrote ${count} records`);
        for (const entry of history) assert.equal(entry.actor, "session:claude-writer", `${tool}: ${entry.type} ${entry.action}`);
        return String(answer.data.id ?? "");
      };
      const story = await write("plan_story", { title: "Signup", ...FOUNDED }, 2);
      const capability = await write("plan_capability", { story, title: "Email", ...FOUNDED }, 2);
      const contract = await write("plan_contract", { capability, title: "Validates email" });
      const arc = await write("plan_arc", { title: "Launch", intent: "Ship signup", end_state: "Visitors join" });
      for (const id of [story, capability, contract, arc]) await write("edit_plan", { id, description: "Corrected" });
      const increment = await write("park_increment", { arc, title: "Form", objective: "Build it", body: "Red then green" });
      await write("ready_increment", { increment });
      await write("claim", { increment, reason: "driving it" });
      for (const parked of [true, false]) await write("park_arc", { arc, parked });
      const blocker = await write("park_increment", { arc, title: "Mailer", objective: "Send mail", body: "Connect it" });
      await write("set_wait", { waiter: increment, on: blocker, reason: "Needs mail" });
      await write("clear_wait", { waiter: increment, on: blocker });
      const questionArgs = { arc, title: "Mailer?", stakes: "Delivery", statement: "Which?", context: "Signup", options: "Mailgun or SES" };
      const question = await write("raise_question", { ...questionArgs, holds: [increment] }, 2);
      await write("correct_question", { question, stakes: "Cost and deliverability" });
      await write("settle_question", { question, answer: "Mailgun" });
      const mistaken = await write("raise_question", questionArgs);
      await write("retire_question", { question: mistaken, reason: "Already asked" });
      await write("close_increment", { increment, disposition: "landed", pr: "#82" });
      await write("park_increment", { arc, title: "Already done", objective: "Done", body: "Finished", outcome: { disposition: "landed", pr: "#83" } });
      for (const result of ["red", "green"]) await write("report", { contract, result });
      for (const fields of [{ kind: "definition", term: "Delivery", meaning: "Verify the sender" }, { kind: "decision", title: "Mailgun", text: "One mailer" }, { kind: "definition", term: "Sender", meaning: "The mail domain" }]) {
        const id = await write("write_note", fields);
        await write("correct_note", { id, ...(fields.kind === "definition" ? { meaning: "The verified domain" } : { text: "Verify the domain" }) });
      }
      const friction = await write("record_friction", { title: "Slow mail", description: "Delay", statement: "Timeout", evidence: "src/mail.ts: Error", impact: "Delayed signup" });
      await write("reinforce", { friction, evidence: "#82: Timeout again" });
      await write("record_resteer", { title: "Simpler", description: "Less UI", doing: "Many fields", redirect: "Just email", evidence: '"Use just email"', disposition: "taste", judged_by: "owner" });
      for (const id of [contract, capability]) await write("retire_from_plan", { id, reason: "Replaced" });

      await log.append(project, { session: "after-clear", harness: "claude-code", source: "hook", kind: "tool-requested", tool: "write_note", call: "new-window", agent: "orchestrator" });
      const afterClear = idOf(await agent.call("write_note", { kind: "definition", term: "Delivery", meaning: "New window" }, { "claudecode/toolUseId": "new-window" }));
      assert.equal((await library.history({ id: afterClear }))[0]?.actor, "session:after-clear");
      await write("write_note", { kind: "definition", term: "Delivery", meaning: "No hook saw this call" });
      const before = await library.history();
      assert.equal((await agent.call("reinforce", { friction, evidence: "Still annoying" })).isError, true);
      assert.deepEqual(await library.history(), before, "a refusal cannot invent an attributed write");
      for (const invalid of ["increment_missing", story]) {
        const refused = await agent.call("raise_question", { ...questionArgs, holds: [blocker, invalid] });
        assert.equal(refused.isError, true, "a missing increment or a different record kind is refused");
        assert.ok(refused.text.includes(invalid), refused.text);
        assert.deepEqual(await library.history(), before, "a refused question cannot leave its question or an earlier hold behind");
      }
    });
    await withAgent(folder, codex("codex-writer"), async (agent) => {
      for (const session of ["codex-writer", "codex-next"]) {
        const id = idOf(await agent.call("write_note", { kind: "definition", term: "Delivery", meaning: session }, { sessionId: session, threadId: "subagent-thread" }));
        assert.equal((await library.history({ id }))[0]?.actor, `session:${session}`, "the session owns the write, including its subagent's");
      }
    });
  });
});

test("6.19 it makes a workspace for an increment: a worktree on a fresh branch from origin's main, where Claude Code keeps its own, with the claim held by the calling session and the way into it named; for work another session holds it gets a readable refusal naming the holder", async () => {
  await withProject(async ({ folder, project, log }) => {
    const origin = path.join(path.dirname(folder), "origin.git");
    git(path.dirname(folder), "init", "--bare", "-b", "main", origin);
    git(folder, "init", "-b", "main");
    git(folder, "add", ".");
    git(folder, "commit", "-m", "first");
    git(folder, "remote", "add", "origin", origin);
    git(folder, "push", "origin", "main");
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const park = async (title: string) => idOf(await agent.call("park_increment", { arc, title, objective: `Build ${title}`, body: `${title}, red then green` }));
      const form = await park("Email form");

      const made = await agent.call("make_workspace", { increment: form, reason: "building the email form" });

      assert.equal(made.isError, false, made.text);
      const { folder: workspace, branch } = made.data as { folder: string; branch: string };
      assert.equal(path.dirname(workspace), path.join(folder, ".claude", "worktrees"));
      assert.equal(git(workspace, "rev-parse", "--abbrev-ref", "HEAD").trim(), branch);
      assert.ok(made.text.includes(workspace) && made.text.includes("EnterWorktree"), made.text);
      assert.deepEqual(
        (await readClaims(log, project)).map(({ increment, session, branch }) => ({ increment, session, branch })),
        [{ increment: form, session: "claude-1", branch }],
      );
    });
    await withAgent(folder, codex("codex-1"), async (agent) => {
      const [held] = (await readClaims(log, project)).map((claim) => claim.increment!);
      const refused = await agent.call("make_workspace", { increment: held, reason: "me too" });
      assert.equal(refused.isError, true);
      assert.ok(refused.text.includes("claude-1"), refused.text);
    });
  });
});

test("ADR-0650 writes proper artifact kinds with default filing and refuses harness memory without writing", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("artifact-writer"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Mail", ...FOUNDED }));
      const capability = idOf(await agent.call("plan_capability", { story, title: "Sender", ...FOUNDED }));
      await agent.call("claim", { capability, reason: "Build the sender" });
      const [cover] = await library.frontCovers(capability);
      const fields = { title: "Verify senders", description: "Check the sending domain", statement: "Verify before sending", why: "Mail must arrive", howToApply: "Verify the domain before enabling delivery" };
      const id = idOf(await agent.call("write_note", { kind: "principle", fields }));
      assert.deepEqual((await library.get(id))?.fields, { ...fields, links: [cover!.id] });
      const before = await library.history();
      const refused = await agent.call("write_note", { kind: "memory", text: "Remember this" });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /memory.*harness.*artifact/i);
      assert.deepEqual(await library.history(), before);
    });
  });
});


test("6.19 Codex gets app creation arguments then attaches the returned worktree through the tools, with readable refusals", async () => {
  await withProject(async ({ folder, project, log }) => {
    const origin = path.join(path.dirname(folder), "origin.git");
    git(path.dirname(folder), "init", "--bare", "-b", "main", origin);
    git(folder, "init", "-b", "main");
    git(folder, "add", ".");
    git(folder, "commit", "-m", "first");
    git(folder, "remote", "add", "origin", origin);
    git(folder, "push", "origin", "main");
    await withAgent(folder, codex("codex-app"), async (agent) => {
      const { arc } = await planned(agent);
      const increment = idOf(await agent.call("park_increment", { arc, title: "Form", objective: "Build form", body: "Red then green" }));
      const prepared = await agent.call("make_workspace", { increment, reason: "build form" });
      assert.equal(prepared.isError, false, prepared.text);
      assert.equal(prepared.data.status, "prepared");
      const { ref, name } = prepared.data as { ref: string; name: string };
      assert.equal(ref, git(folder, "rev-parse", "HEAD").trim());
      assert.match(prepared.text, /create_worktree/);
      assert.match(prepared.text, /attach_workspace/);
      assert.ok(prepared.text.includes(`git worktree add --detach <folder> ${ref}`), prepared.text);
      assert.doesNotMatch(prepared.text, /desktop app/);
      assert.deepEqual(await readClaims(log, project), []);
      const returnedFolder = path.join(path.dirname(folder), "app returned");
      git(folder, "worktree", "add", "--detach", returnedFolder, ref);
      const refused = await agent.call("attach_workspace", { increment, reason: "build form", ref, name, folder });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /kept|untouched/);
      const attached = await agent.call("attach_workspace", { increment, reason: "build form", ref, name, folder: returnedFolder });
      assert.equal(attached.isError, false, attached.text);
      assert.equal(attached.data.folder, returnedFolder);
      assert.equal(attached.data.branch, `codex/${name}`);
      assert.equal((await readClaims(log, project))[0]?.session, "codex-app");
      assert.equal((await readClaims(log, project))[0]?.branch, attached.data.branch);
      assert.ok(attached.text.includes(returnedFolder));
    });
  });
});

test("6.19 a Claude Code session attaches the linked worktree it is in through the tool, on that worktree's branch, with no ref or name", async () => {
  await withProject(async ({ folder, project, log }) => {
    git(folder, "init", "-b", "main");
    git(folder, "add", ".");
    git(folder, "commit", "-m", "first");
    const ownFolder = path.join(path.dirname(folder), "desktop worktree");
    git(folder, "worktree", "add", "-b", "claude/desktop-own", ownFolder);
    await withAgent(folder, claudeCode("claude-desktop"), async (agent) => {
      const { arc } = await planned(agent);
      const increment = idOf(await agent.call("park_increment", { arc, title: "Form", objective: "Build form", body: "Red then green" }));
      const attached = await agent.call("attach_workspace", { increment, reason: "build form", folder: ownFolder });
      assert.equal(attached.isError, false, attached.text);
      assert.equal(attached.data.branch, "claude/desktop-own");
      assert.deepEqual(
        (await readClaims(log, project)).map(({ increment, session, branch }) => ({ increment, session, branch })),
        [{ increment, session: "claude-desktop", branch: "claude/desktop-own" }],
      );
    });
  });
});

test("6.31 search_notes answers with the library's ranked search (capability 14), at most `limit`, and says why when it fell back to words", async () => {
  await withProject(async ({ folder, library }) => {
    for (const n of [1, 2, 3]) await library.defineTerm({ term: `Mailer ${n}`, meaning: "The mailer needs a verified sender domain." });

    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const answer = await agent.call("search_notes", { query: "mailer", limit: 2 });

      assert.match(answer.text, /ranked by words: the embedding model is switched off/);
      // Notes made in the same millisecond tie in creation order (their random ids break it), so which two come back is not pinned.
      assert.equal(answer.text.match(/"Mailer \d"/g)?.length, 2);
    });
  });
});

test("6.25 search_notes finds a story, a capability and a contract by their own words, each labelled by its type, as `storytree library search` does", async () => {
  await withProject(async ({ folder, library }) => {
    const story = await library.addStory({ title: "Visitor can sign up", description: "A visitor leaves a postcode" });
    const capability = await library.addCapability({ title: "Postcode form", story: story.id, description: "Takes a postcode" });
    const contract = await library.addContract({ title: "Rejects a postcode with letters only", capability: capability.id, description: "A bad postcode is refused" });

    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const answer = await agent.call("search_notes", { query: "postcode" });

      assert.deepEqual(
        (answer.data.notes as { id: string; kind: string; spine: string; firstLine: string }[]).map(({ id, kind, spine, firstLine }) => ({ id, kind, spine, firstLine })).sort((a, b) => a.kind.localeCompare(b.kind)),
        [
          { id: capability.id, kind: "capability", spine: "Postcode form", firstLine: "Takes a postcode" },
          { id: contract.id, kind: "contract", spine: "Rejects a postcode with letters only", firstLine: "A bad postcode is refused" },
          { id: story.id, kind: "story", spine: "Visitor can sign up", firstLine: "A visitor leaves a postcode" },
        ],
      );
      assert.match(answer.text, /"Rejects a postcode with letters only" \(contract_\w+\): A bad postcode is refused/);
    });
  });
});

test("6.27 correct_question corrects an open question's wording in place: only the fields given change and it keeps its id; a settled question keeps its words and answer, and a missing question or no words get a readable refusal", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const asked = { arc, title: "Which mailer?", stakes: "Cost", statement: "Send through Mailgun or SES?", context: "Both work here", options: "Mailgun; SES" };
      const question = idOf(await agent.call("raise_question", asked));
      const wordsOf = async (id: string) => (await library.arcView(arc))?.questions.find((one) => one.id === id)?.fields;

      const corrected = await agent.call("correct_question", { question, stakes: "Cost and deliverability", recommendation: "Mailgun" });
      assert.equal(corrected.isError, false, corrected.text);
      assert.equal(corrected.data.id, question);
      const words = await wordsOf(question);
      assert.deepEqual([words?.title, words?.stakes, words?.statement, words?.recommendation], ["Which mailer?", "Cost and deliverability", "Send through Mailgun or SES?", "Mailgun"]);

      const nothing = await agent.call("correct_question", { question });
      assert.equal(nothing.isError, true);
      assert.match(nothing.text, /Give the words to change/);

      const missing = await agent.call("correct_question", { question: "question_000000000000", title: "Anything" });
      assert.equal(missing.isError, true);
      assert.match(missing.text, /no question question_000000000000/);

      await agent.call("settle_question", { question, answer: "Mailgun" });
      const settled = await agent.call("correct_question", { question, title: "Which mail provider?" });
      assert.equal(settled.isError, true);
      assert.match(settled.text, /settled/);
      assert.deepEqual([(await wordsOf(question))?.title, (await wordsOf(question))?.answer], ["Which mailer?", "Mailgun"]);
    });
  });
});

test("6.26 open on a contract shows it whole: its title, its description and the capability it belongs to; an arc is still refused readably", async () => {
  await withProject(async ({ folder, library }) => {
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "Postcode form", story: story.id });
    const contract = await library.addContract({ title: "Rejects a postcode with letters only", capability: capability.id, description: "A bad postcode is refused" });
    const arc = await library.createArc({ title: "Signup release", intent: "Ship signup", endState: "Signup live" });

    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const opened = await agent.call("open", { id: contract.id });

      assert.equal(opened.isError, false);
      assert.match(opened.text, /Contract "Rejects a postcode with letters only" \(contract_\w+\):\nA bad postcode is refused/);
      assert.match(opened.text, new RegExp(`Capability "Postcode form" \\(${capability.id}\\)`));
      assert.deepEqual(opened.data.contract, { id: contract.id, title: "Rejects a postcode with letters only", description: "A bad postcode is refused", capability: { id: capability.id, title: "Postcode form" } });

      const refused = await agent.call("open", { id: arc.id });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /is an arc/);
    });
  });
});

test("6.28 move_increment moves an open increment to another arc keeping its id, with the session as writer and the reason in its history; a closed increment, a closed or missing arc and a missing increment get a readable refusal, with nothing written", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const target = idOf(await agent.call("plan_arc", { title: "Launch v2", intent: "Ship more", end_state: "More visitors" }));
      const ids = async (on: string) => (await library.arcView(on))?.increments.map((one) => one.id) ?? [];
      const increment = idOf(await agent.call("park_increment", { arc, title: "Email form", objective: "Build it", body: "Red then green" }));

      const moved = await agent.call("move_increment", { increment, to: target, reason: "belongs to v2" });
      assert.equal(moved.isError, false, moved.text);
      assert.ok((await ids(target)).includes(increment), "the target arc lists it");
      assert.ok(!(await ids(arc)).includes(increment), "the old arc no longer does");
      const last = (await library.history({ id: increment })).at(-1);
      assert.equal(last?.actor, "session:claude-1");
      assert.equal(last?.reason, "belongs to v2");

      const closedArc = idOf(await agent.call("plan_arc", { title: "Done", intent: "Was done", end_state: "Done" }));
      await agent.call("park_increment", { arc: closedArc, title: "Old", objective: "Done", body: "Done", outcome: { disposition: "landed", pr: "#1" } });
      const done = idOf(await agent.call("park_increment", { arc: target, title: "Shipped", objective: "Done", body: "Done", outcome: { disposition: "landed", pr: "#2" } }));
      for (const [args, why] of [
        [{ increment, to: closedArc, reason: "r" }, "a closed arc"],
        [{ increment, to: "arc_000000000000", reason: "r" }, "a missing arc"],
        [{ increment: done, to: arc, reason: "r" }, "a closed increment"],
        [{ increment: "increment_000000000000", to: arc, reason: "r" }, "a missing increment"],
      ] as const) {
        const refused = await agent.call("move_increment", args);
        assert.equal(refused.isError, true, `${why} is refused: ${refused.text}`);
      }
      assert.ok((await ids(target)).includes(increment) && (await ids(target)).includes(done), "nothing moved");
    });
  });
});
