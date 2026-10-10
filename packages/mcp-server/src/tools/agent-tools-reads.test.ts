/**
 * Capability 6 · Agent tools (the MCP server), in the agent link story: what each call records and reads (sessions, notes, context), refusals with storytree stopped, increments and plan health. One of three files
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
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { createServer, connect as openSocket, type AddressInfo, type Socket } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "@modelcontextprotocol/client";
import { connect, type Library } from "@storytree/library";
import { worklist } from "@storytree/librarian";
import pg from "pg";

import { openActivityLog, type Line } from "@storytree/agent-link";
import { readClaims } from "@storytree/agent-link";
import { MARKER_FILE } from "@storytree/agent-link";
import { claudeCode, codex, idOf, withAgent } from "../testing/agent.js";
import { git, withTempDir } from "@storytree/agent-link/testing/folders";
import { approveCheckout, dropTestProjects, placeTestServer, projectDatabase, testServerUrl, uniqueProjectName } from "@storytree/agent-link/testing/pg";
import { NOT_RUNNING_ANSWER } from "./index.js";
import { registerWorkTools } from "./work-tools.js";
import type { Answer, Call, Define } from "./server.js";
import { FOUNDED, planned, TOOLS, withProject } from "../testing/tool-world.js";

/** A note's fields, as the library holds them. */
async function noteFields(library: Library, id: string): Promise<{ links?: string[] }> {
  const found = (await library.search("")).find((note) => note.id === id);
  assert.ok(found !== undefined, `note ${id} is in the library`);
  return found.fields as { links?: string[] };
}

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
    await approveCheckout(folder, project);
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

test("in a folder whose project was deleted and a new project of its name set up since, a tool says the folder's project was deleted and does not reach the new one", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    const storytree = await connect({ url: testServerUrl() });
    try {
      const first = await storytree.openProject(project);
      await first.close();
      writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project, identity: first.identity })}\n`);
      await approveCheckout(folder, project);
      await storytree.dropProject(project); // deleted from another computer; this folder still names it
      await (await storytree.openProject(project)).close(); // and a new project of that name set up elsewhere
      await withAgent(folder, claudeCode("claude-1"), async (agent) => {
        const plan = await agent.call("show_plan");
        assert.equal(plan.isError, true);
        assert.match(plan.text, /deleted/);
        assert.match(plan.text, /\.storytree\.json/);
      });
    } finally {
      await storytree.close();
      await dropTestProjects([project]);
    }
  });
});

test("6.43 a tool called from a checkout not approved for the project its marker names, even with the project's identity, is refused saying how to approve it, and writes no line; joining on purpose approves it (ADR-0942)", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = path.join(dir, "storytree-home");
    mkdirSync(home);
    placeTestServer(path.join(home, "pgdata"));
    const folder = path.join(dir, "download");
    mkdirSync(folder);
    const storytree = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      const existing = await storytree.openProject(project);
      await existing.close();
      writeFileSync(path.join(folder, MARKER_FILE), JSON.stringify({ project, identity: existing.identity }));
      await withAgent(folder, claudeCode("downloaded", { dataDir: path.join(home, "pgdata"), setup: { homes: {}, storytreeHome: home } }), async (agent) => {
        for (const [tool, args] of [["show_plan", {}], ["plan_story", { title: "Visitor can sign up", ...FOUNDED }], ["check_setup", {}]] as const) {
          const refused = await agent.call(tool, args);
          assert.equal(refused.isError, true, tool);
          assert.match(refused.text, /not approved/, tool);
          assert.match(refused.text, /storytree doctor --join/, tool);
        }
        assert.deepEqual(await log.lines(project, { sessions: ["downloaded"] }), [], "nothing is recorded in the project");

        const joined = await agent.call("set_up_project", { name: project, join: true });
        assert.equal(joined.isError, false, joined.text);
        idOf(await agent.call("plan_story", { title: "Visitor can sign up", ...FOUNDED }));
      });
    } finally {
      await log.close();
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
        ["focus", { select: "story:Example" }],
        ["health_worklist", {}],
        ["stale_claims", {}],
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
        ["close_increment", { increment: "increment_000000000000", disposition: "landed", pr: "#1" }],
        ["move_increment", { increment: "increment_000000000000", to: "arc_000000000000", reason: "belongs there" }],
        ["add_remedies", { increment: "increment_000000000000", frictions: ["friction_000000000000"] }],
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
        ["present_question", { question: "question_000000000000" }],
        ["retire_question", { question: "question_000000000000", reason: "asked in error" }],
        ["read_context", {}],
        ["close_out", { safe: true, why: "all merged" }],
        ["name_session", { title: "Building signup" }],
        ["wire_pipeline", { test: "npm test" }],
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
    await withProject(async ({ folder, project }) => {
      const dataDir = path.join(folder, "pgdata");
      placeTestServer(dataDir, { port: (silent.address() as AddressInfo).port });
      await approveCheckout(folder, project, folder);
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
    placeTestServer(path.join(storytreeHome, "pgdata"));
    await approveCheckout(folder, project, storytreeHome);
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


test("6.9 it parks an increment, starts it by claiming it, and closes it landed with its pull request, which ends the claim and closes the arc; it records a landing never parked, parks new work on the closed arc, which re-opens it, and parks and unparks the arc", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc, capability } = await planned(agent);
      const incrementOf = async (id: string) => (await library.arcView(arc))?.increments.find((one) => one.id === id)?.fields;

      const increment = idOf(await agent.call("park_increment", { arc, title: "Email form", objective: "Build the email form", body: "Red then green, contract by contract", capabilities: [capability] }));
      assert.equal((await incrementOf(increment))?.status, "proposal");
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

test("6.9 a committed close remains successful when a newer sibling schema prevents reading its arc", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    await withAgent(folder, codex("closing-agent"), async (agent) => {
      const { arc } = await planned(agent);
      const increment = idOf(await agent.call("park_increment", { arc, title: "Email form", objective: "Build it", body: "Ready to close" }));
      const future = await library.addIncrement({ arc, title: "Future work", objective: "Later", body: "Written by newer code" });
      assert.equal((await agent.call("claim", { increment, reason: "Finish form" })).isError, false);
      const url = new URL(testServerUrl());
      url.pathname = `/${projectDatabase(project)}`;
      const writer = new pg.Client({ connectionString: url.href });
      await writer.connect();
      try {
        await writer.query("UPDATE record SET version = 999 WHERE id = $1", [future.id]);
        const answer = await agent.call("close_increment", { increment, disposition: "landed", pr: "#12" });
        const saved = await library.get(increment);
        assert.equal(saved?.type, "increment");
        if (saved?.type !== "increment") throw new Error("The increment must still exist");
        assert.equal(saved.fields.status, "closed");
        assert.equal(saved.fields.outcome?.disposition, "landed");
        assert.equal(saved.fields.outcome?.pr, "#12");
        assert.deepEqual(await readClaims(log, project), [], "the committed close ended its claim");
        assert.equal(answer.isError, false, answer.text);
        assert.equal(answer.data.id, increment);
        assert.equal(answer.data.disposition, "landed");
        assert.ok(answer.text.startsWith(`Closed "Email form" (${increment}), landed.`), answer.text);
        assert.match(answer.text, /follow-up arc read.*failed/i);
        assert.ok(answer.text.includes(future.id), answer.text);
        assert.match(answer.text, /schema version 999/);
        assert.match(answer.text, /git pull/);
        assert.match(answer.text, /pnpm install/);
        assert.match(answer.text, /restart the agent link/);

        const before = await library.history({ id: future.id });
        const refused = await agent.call("close_increment", { increment: future.id, disposition: "withdrawn", note: "Cannot read it" });
        assert.equal(refused.isError, true, refused.text);
        assert.doesNotMatch(refused.text, /^Closed/);
        assert.deepEqual(await library.history({ id: future.id }), before, "a pre-write schema refusal wrote nothing");
      } finally {
        await writer.end();
      }
    });
  });
});

for (const tool of ["park_increment", "move_increment"] as const) {
  test(`${tool === "park_increment" ? "6.9" : "6.28"} ${tool} keeps its committed result when a follow-up arc read fails`, async () => {
    await withProject(async ({ folder, project, library, log }) => {
      const arc = await library.createArc({ title: "Launch", intent: "Ship it", endState: "Shipped" });
      const done = await library.addIncrement({ arc: arc.id, title: "Earlier work", objective: "Ship it", body: "Done", outcome: { disposition: "landed", pr: "#1" } });
      const acts = new Map<string, (args: never, call: Call) => Promise<Answer>>();
      registerWorkTools(((name, _description, _input, act) => acts.set(name, act as never)) as Define);
      let committed = false;
      const unavailable = new Proxy(library, {
        get(target, key) {
          if (key === "arcView") return async (id: string) => {
            if (committed) throw new Error("Arc connection lost");
            return target.arcView(id);
          };
          if (key === "addIncrement" || key === "moveIncrement") return async (...args: never[]) => {
            const saved = await (target[key] as (...input: never[]) => Promise<unknown>)(...args);
            committed = true;
            return saved;
          };
          const value = Reflect.get(target, key) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const call = { library: unavailable, log, project, folder, caller: { session: "writer" }, writer: {}, quietMs: 60_000, agent: "orchestrator" } as Call;
      const args = tool === "park_increment"
        ? { arc: arc.id, title: "Next work", objective: "Ship next", body: "Ready" }
        : { increment: done.id, to: arc.id, reason: "Keep completed history here" };
      const answer = await acts.get(tool)!(args as never, call);
      assert.notEqual(answer.refused, true, answer.text);
      assert.equal(committed, true);
      const saved = await library.get(String(answer.data?.id));
      assert.equal(saved?.type, "increment");
      assert.ok(answer.text.startsWith(tool === "park_increment" ? "Parked " : "Moved "), answer.text);
      assert.match(answer.text, /follow-up arc read.*failed.*Arc connection lost/i);
    });
  });
}

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

test("6.30 health_worklist gives the oldest three capabilities on the health worklist, each with its reason, who moves it, the contracts carrying it and since when, and how many more wait; a capability an open increment lists among its capabilities is not offered, and one a test run in progress will record is held back and counted", async () => {
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
      await agent.call("park_increment", { arc, title: "Thank-you page", objective: "Build it", body: "Red then green", capabilities: [routed] });

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

      await library.markVerifiedPending(check, { by: "storytree test run on CI", note: "a test run at commit abc123 is recording it" });
      const held = await agent.call("health_worklist");
      assert.deepEqual((held.data.items as { capability: string }[]).map((item) => item.capability), [later[1], later[2], later[3]], "held back, its slot filled");
      assert.deepEqual(held.data.held, [capability]);
      assert.equal(held.data.more, 0);
      assert.match(held.text, /1 held back.*a test run at commit abc123 is recording it/);
    });
  });
});

test("6.49 stale_claims gives the session manager each claimed increment whose holder is quiet, with its holder and route; reading it ends nothing", async () => {
  await withProject(async ({ folder, project, log }) => {
    const pulls = { allOpenPulls: async () => new Map() };
    await withAgent(folder, claudeCode("claude-1", { quietMs: 500, merges: pulls }), async (agent) => {
      assert.match((await agent.call("stale_claims")).text, /No claimed increment is stale/);
      const { arc } = await planned(agent);
      const increment = idOf(await agent.call("park_increment", { arc, title: "Email form", objective: "Build it", body: "Red then green" }));
      assert.equal((await agent.call("claim", { increment, reason: "driving it" })).isError, false);
      await delay(800);
      await withAgent(folder, codex("codex-1", { quietMs: 500, merges: pulls }), async (manager) => {
        const listed = await manager.call("stale_claims");
        assert.equal(listed.isError, false, listed.text);
        assert.deepEqual((listed.data.claims as { increment: string; holder: string; route: string }[]).map(({ increment, holder, route }) => [increment, holder, route]),
          [[increment, "claude-1", "ask"]]);
        assert.match(listed.text, /Email form[^\n]*claude-1 \(driving it\)[^\n]*ask its holder/);
      });
      assert.deepEqual((await readClaims(log, project, { quietMs: 500 })).map(({ increment }) => increment), [increment], "reading it ended nothing");
    });
  });
});
