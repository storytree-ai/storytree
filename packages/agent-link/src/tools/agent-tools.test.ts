/**
 * Capability 6 · Agent tools (the MCP server): one test per contract 6.1-6.8 in
 * stories/agent-link.md. A test client talks to the server inside the test itself, over an
 * in-memory transport, with no real agent and no network, as Claude Code or Codex would: Claude
 * Code's session id reaches the server in its environment, Codex's on each call's `_meta`, and each
 * call's `_meta` carries its id as that harness sends it.
 *
 * The server works in a throwaway folder set up as a project (named with uniqueProjectName(), its
 * library dropped afterwards), and finds storytree from the test Postgres's own owner record.
 * What the tests check is read back through the library and the activity log themselves.
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog, type Line } from "../activity/index.js";
import { recordFriction, reinforceFriction } from "../index.js";
import { readClaims } from "../claims/index.js";
import { MARKER_FILE } from "../routing/index.js";
import { claudeCode, codex, idOf, withAgent, type Agent } from "../testing/agent.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { NOT_RUNNING_ANSWER } from "./index.js";

/** The toolbox: every tool the server offers. */
const TOOLS = [
  "check_setup",
  "claim",
  "clear_wait",
  "close_increment",
  "correct_note",
  "edit_plan",
  "land",
  "open",
  "park_arc",
  "park_increment",
  "plan_arc",
  "plan_capability",
  "plan_contract",
  "plan_story",
  "raise_question",
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
        { session: "claude-1", state: "live" },
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
        ["claim", { capability: "capability_000000000000", reason: "building it" }],
        ["release", { capability: "capability_000000000000" }],
        ["report", { contract: "contract_000000000000", result: "red" }],
        ["land", { capability: "capability_000000000000" }],
        ["search_notes", { query: "mailgun" }],
        ["open", { id: "decision_000000000000" }],
        ["write_note", { kind: "memory", text: "Mailgun needs a verified domain" }],
        ["correct_note", { id: "memory_000000000000", text: "Mailgun needs a verified sending domain" }],
        ["retire_from_plan", { id: "contract_000000000000", reason: "no longer promised" }],
        ["park_increment", { arc: "arc_000000000000", title: "Email form", objective: "Build it", body: "Red then green" }],
        ["ready_increment", { increment: "increment_000000000000" }],
        ["close_increment", { increment: "increment_000000000000", disposition: "landed", pr: "#1" }],
        ["park_arc", { arc: "arc_000000000000", parked: true }],
        ["set_wait", { waiter: "increment_000000000000", on: "increment_000000000001", reason: "it comes first" }],
        ["clear_wait", { waiter: "increment_000000000000", on: "increment_000000000001" }],
        ["record_friction", { title: "Slow", description: "Slow", statement: "Slow", evidence: "`pnpm test` took 9 s", impact: "Slow" }],
        ["reinforce", { friction: "friction_000000000000", evidence: "#81: timed out again" }],
        ["record_resteer", { title: "Redirected", description: "Redirected", doing: "a", redirect: "b", evidence: '"not that"', disposition: "taste", judged_by: "owner" }],
        ["raise_question", { arc: "arc_000000000000", title: "Which mailer?", stakes: "Cost", statement: "Mailgun or SES?", context: "Both work", options: "Mailgun; SES" }],
        ["settle_question", { question: "question_000000000000", answer: "Mailgun" }],
        ["retire_question", { question: "question_000000000000", reason: "asked in error" }],
      ];
      // Every tool but the setup check's two, which open storytree when it is closed (capability 8).
      const setupTools = ["check_setup", "set_up_project"];
      assert.deepEqual(calls.map(([tool]) => tool).sort(), TOOLS.filter((tool) => !setupTools.includes(tool)), "every tool is tried");
      for (const [tool, args] of calls) {
        const answer = await agent.call(tool, args);
        assert.deepEqual({ text: answer.text, isError: answer.isError }, { text: NOT_RUNNING_ANSWER, isError: false }, tool);
      }
    });
  });
});

test("6.5 a note written with no place named while holding a claim goes onto that capability's shelf (ADR-0627 D4), and one written with no claim gets no default place", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Visitor can sign up", ...FOUNDED }));
      const form = idOf(await agent.call("plan_capability", { story, title: "Email form", founding: { title: "Send through Mailgun", text: "Its API is the simplest" } }));
      const [founding] = (await library.frontCovers(form)).map((cover) => cover.id);
      assert.ok(founding !== undefined, "the capability is born with its founding decision on its shelf");

      // No claim: no default place.
      const loose = idOf(await agent.call("write_note", { kind: "memory", text: "Written before any claim" }));
      assert.deepEqual((await noteFields(library, loose)).links, undefined);

      await agent.call("claim", { capability: form, reason: "building the email form" });
      const arc = idOf(await agent.call("plan_arc", { title: "Launch", intent: "Ship signup", end_state: "Visitors join" }));
      const increment = idOf(await agent.call("park_increment", { arc, title: "Signup release", objective: "Ship the form", body: "Red then green" }));
      assert.equal((await agent.call("claim", { increment, reason: "driving the release too" })).isError, false);
      // A memory, with no cover opened yet this session, goes inside the shelf's first book: its founding decision.
      const first = idOf(await agent.call("write_note", { kind: "memory", text: "Mailgun needs a verified domain" }));
      // A new decision becomes another front cover of the claimed capability; once this session has opened it, a new memory goes inside that one.
      const second = idOf(await agent.call("write_note", { kind: "decision", title: "Validate on the client first", text: "Before any request" }));
      await agent.call("open", { id: second });
      const latest = idOf(await agent.call("write_note", { kind: "definition", term: "Bounce", meaning: "An email that could not be delivered" }));
      // A place the agent names itself always wins.
      const named = idOf(await agent.call("write_note", { kind: "memory", text: "Filed where I say", links: [founding] }));

      assert.deepEqual((await library.frontCovers(form)).map((cover) => cover.id), [founding, second]);
      assert.deepEqual((await noteFields(library, first)).links, [founding]);
      assert.deepEqual((await noteFields(library, latest)).links, [second]);
      assert.deepEqual((await noteFields(library, named)).links, [founding]);

      // Holding a capability whose shelf is empty, as one made through the library itself can be: nothing is added, and the agent is told.
      const link = (await library.addCapability({ title: "Confirmation link", story })).id;
      await agent.call("claim", { capability: link, reason: "building the confirmation link" });
      const unshelved = await agent.call("write_note", { kind: "memory", text: "Links expire after a day" });
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
    const inside = await library.writeMemory({ text: "Mailgun needs a verified domain", links: [cover.id] });
    const other = await library.writeMemory({ text: "Bounces arrive by webhook" });
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
    const note = await library.writeMemory({ text: "Mailgun needs a verified domain" });
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
      const memory = idOf(await agent.call("write_note", { kind: "memory", text: "The form tiemout is 30 s", links: [decision] }));

      assert.equal(idOf(await agent.call("correct_note", { id: memory, text: "The form timeout is 30 s" })), memory);
      assert.equal(idOf(await agent.call("correct_note", { id: decision, title: "Validate on the server too" })), decision);
      const [cover] = await library.frontCovers(capability).then((shelf) => shelf.filter((note) => note.id === decision));
      assert.deepEqual([cover?.fields.title, cover?.fields.text], ["Validate on the server too", "Clients lie"], "only the title changed");
      assert.deepEqual((await library.search("timeout")).map((note) => note.id), [memory]);
      assert.deepEqual(await library.search("tiemout"), []);

      const missing = await agent.call("correct_note", { id: "no-such-note", text: "anything" });
      assert.equal(missing.isError, true);
      assert.match(missing.text, /no-such-note/);
      const wrongField = await agent.call("correct_note", { id: memory, title: "A memory has no title" });
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
      const note = await library.writeMemory({ text: "Not friction" });
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
      await write("settle_question", { question, answer: "Mailgun" });
      const mistaken = await write("raise_question", questionArgs);
      await write("retire_question", { question: mistaken, reason: "Already asked" });
      await write("close_increment", { increment, disposition: "landed", pr: "#82" });
      await write("park_increment", { arc, title: "Already done", objective: "Done", body: "Finished", outcome: { disposition: "landed", pr: "#83" } });
      for (const result of ["red", "green"]) await write("report", { contract, result });
      for (const fields of [{ kind: "memory", text: "Verify the sender" }, { kind: "decision", title: "Mailgun", text: "One mailer" }, { kind: "definition", term: "Sender", meaning: "The mail domain" }]) {
        const id = await write("write_note", fields);
        await write("correct_note", { id, ...(fields.kind === "definition" ? { meaning: "The verified domain" } : { text: "Verify the domain" }) });
      }
      const friction = await write("record_friction", { title: "Slow mail", description: "Delay", statement: "Timeout", evidence: "src/mail.ts: Error", impact: "Delayed signup" });
      await write("reinforce", { friction, evidence: "#82: Timeout again" });
      await write("record_resteer", { title: "Simpler", description: "Less UI", doing: "Many fields", redirect: "Just email", evidence: '"Use just email"', disposition: "taste", judged_by: "owner" });
      for (const id of [contract, capability]) await write("retire_from_plan", { id, reason: "Replaced" });

      await log.append(project, { session: "after-clear", harness: "claude-code", source: "hook", kind: "tool-requested", tool: "write_note", call: "new-window", agent: "orchestrator" });
      const afterClear = idOf(await agent.call("write_note", { kind: "memory", text: "New window" }, { "claudecode/toolUseId": "new-window" }));
      assert.equal((await library.history({ id: afterClear }))[0]?.actor, "session:after-clear");
      await write("write_note", { kind: "memory", text: "No hook saw this call" });
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
        const id = idOf(await agent.call("write_note", { kind: "memory", text: session }, { sessionId: session, threadId: "subagent-thread" }));
        assert.equal((await library.history({ id }))[0]?.actor, `session:${session}`, "the session owns the write, including its subagent's");
      }
    });
  });
});
