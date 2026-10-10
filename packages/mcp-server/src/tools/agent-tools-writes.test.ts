/**
 * Capability 6 · Agent tools (the MCP server), in the MCP server story: waits, friction and re-steers, corrections and retirements, questions, other stories' tools, workspaces, search, and bounded reads. One of three files
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
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { roundDue, route, worklist } from "@storytree/librarian";
import { z } from "zod";

import { recordFriction, reinforceFriction } from "@storytree/session-management";
import type { ToolExtension } from "./index.js";
import { readClaims } from "@storytree/session-management";
import { MARKER_FILE } from "@storytree/session-management";
import { claudeCode, codex, idOf, withAgent } from "../testing/agent.js";
import { countingStore, longHistory } from "@storytree/session-management/testing/egress";
import { git } from "@storytree/session-management/testing/folders";
import { approveCheckout, placeTestServer, uniqueProjectName } from "@storytree/session-management/testing/pg";
import { FOUNDED, planned, TOOLS, withProject } from "../testing/tool-world.js";

test("6.4 a held claim refusal explains the running command and dirty-main close-out disagreement", async () => {
  await withProject(async ({ folder, log, project }) => {
    await withAgent(folder, claudeCode("contender"), async (agent) => {
      const { capability } = await planned(agent);
      const own = { session: "holder", harness: "codex", source: "hook", folder, branch: "main", machine: "mint" } as const;
      await log.append(project, { ...own, kind: "claimed", capability, reason: "unfinished work" });
      await log.append(project, { ...own, kind: "command-started", call: "lost-finish", command: "pnpm test" });
      await log.append(project, { ...own, kind: "file-edited", files: ["unfinished.ts"] });
      await log.append(project, { ...own, kind: "main-state", of: folder, dirty: true });
      await log.append(project, { ...own, kind: "closed-out", safe: true, why: "claimed done", running: 0 });
      const refused = await agent.call("claim", { capability, reason: "next writer" });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /session holder/);
      assert.match(refused.text, /binds:.*command is still recorded as running/);
      assert.match(refused.text, /worked on main/);
    });
  });
});

test("6.4 a held claim refusal names the increment its holder holds the work for, and when it is free; a holder holding no increment is named with neither", async () => {
  await withProject(async ({ folder, log, project }) => {
    await withAgent(folder, claudeCode("contender"), async (agent) => {
      const { arc, story, capability } = await planned(agent);
      const increment = idOf(await agent.call("park_increment", { arc, title: "Sign-up form", objective: "Build it", body: "Red then green" }));
      const loose = idOf(await agent.call("plan_capability", { story, title: "Welcome mail", ...FOUNDED }));
      const own = { session: "holder", harness: "codex", source: "hook", folder, branch: "main", machine: "mint" } as const;
      await log.append(project, { ...own, kind: "claimed", increment, reason: "driving the form" });
      await log.append(project, { ...own, kind: "claimed", capability, reason: "building the form" });
      await log.append(project, { ...own, session: "loner", kind: "claimed", capability: loose, reason: "writing the mail" });
      const refused = await agent.call("claim", { capability, reason: "next writer" });
      assert.equal(refused.isError, true);
      assert.match(refused.text, new RegExp(`session holder for ${increment} \\(building the form\\)`));
      assert.match(refused.text, new RegExp(`free once ${increment} closes`));
      const alone = await agent.call("claim", { capability: loose, reason: "next writer" });
      assert.equal(alone.isError, true);
      assert.match(alone.text, /session loner \(writing the mail\)/);
      assert.doesNotMatch(alone.text, /free once/);
    });
  });
});

test("6.42 close_out reports the calling session's released claims, and a repeated call releases none", async () => {
  await withProject(async ({ folder, log, project }) => {
    await withAgent(folder, claudeCode("closing"), async (agent) => {
      const { capability } = await planned(agent);
      assert.equal((await agent.call("claim", { capability, reason: "finish work" })).isError, false);
      const answer = await agent.call("close_out", { safe: false, why: "handoff" });
      assert.equal(answer.isError, false, answer.text);
      assert.match(answer.text, new RegExp(`Released claims: ${capability}`));
      assert.deepEqual(answer.data?.released, [capability]);
      assert.deepEqual(await readClaims(log, project), []);
      const again = await agent.call("close_out", { safe: false, why: "already handed off" });
      assert.deepEqual(again.data?.released, []);
      assert.match(again.text, /No claims to release/);
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

test("6.40 it sets a wait for the owner or an outside event with a note, and a claim on it is refused naming the note; an event wait needs a check-back day; it clears the wait, and the claim succeeds", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const install = idOf(await agent.call("park_increment", { arc, title: "Real install", objective: "Install it for real", body: "On the old laptop" }));
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

      const undated = await agent.call("set_wait", { waiter: install, for: "event", note: "the next release build" });
      assert.equal(undated.isError, true);
      assert.match(undated.text, /check-back day/);
      assert.equal((await agent.call("set_wait", { waiter: install, for: "owner", note: "run the NSIS install on the old laptop" })).isError, false);
      assert.equal((await agent.call("set_wait", { waiter: install, for: "event", note: "the next release build", check_back: tomorrow })).isError, false);
      const refused = await agent.call("claim", { increment: install, reason: "driving it" });
      assert.equal(refused.isError, true);
      assert.ok(refused.text.includes("run the NSIS install on the old laptop") && refused.text.includes("the next release build"), refused.text);

      assert.equal((await agent.call("clear_wait", { waiter: install, for: "owner" })).isError, false);
      assert.equal((await agent.call("clear_wait", { waiter: install, for: "event" })).isError, false);
      assert.deepEqual(await library.waitsFor(install), []);
      assert.equal((await agent.call("claim", { increment: install, reason: "driving it" })).isError, false);
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

test("6.36 the daily friction cap counts each session's own reports: on a branch every session shares, a second session's report is accepted after another filed three that day, and each is still refused its own fourth", async () => {
  await withProject(async ({ folder, library }) => {
    git(folder, "init", "-b", "main");
    const report = (title: string) => ({ title, description: title, statement: title, evidence: `src/${title}.ts: Error`, impact: "Lost time" });
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      for (const title of ["one", "two", "three"]) assert.equal((await agent.call("record_friction", report(title))).isError, false);
      assert.equal((await agent.call("record_friction", report("four"))).isError, true, "the first session's own fourth is refused");
    });
    await withAgent(folder, claudeCode("claude-2"), async (agent) => {
      const later = await agent.call("record_friction", report("islands"));
      assert.equal(later.isError, false, later.text);
      const saved = await library.get(idOf(later));
      assert.ok(saved?.type === "friction");
      assert.equal(saved.fields.title, "islands");
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

test("6.35 a re-steer whose evidence is the user's exact words without quotation marks is refused with the step that passes, putting those words inside double quotation marks, and the same words inside them are then recorded (regression: Conduit 3 on the reset laptop, 2026-10-02)", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const words = "I know Your Feed was meant for part 5, but the tests expect the tab to be there as soon as people can sign in. Can you add it now?";
      const resteer = (evidence: string) => agent.call("record_resteer", {
        title: "Your Feed now, not in part 5",
        description: "The user moved the feed tab forward",
        doing: "Leaving the feed tab for part 5",
        redirect: "Add the feed tab as soon as people can sign in",
        evidence,
        disposition: "taste",
        judged_by: "owner",
      });
      const refused = await resteer(words);
      assert.equal(refused.isError, true);
      assert.match(refused.text, /double quotation marks/, refused.text);
      const recorded = await resteer(`"${words}"`);
      assert.notEqual(recorded.isError, true, recorded.text);
      const stored = (await library.search("Your Feed")).find((note) => note.id === idOf(recorded))?.fields as { evidence?: string } | undefined;
      assert.equal(stored?.evidence, `"${words}"`);
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

test("6.11 it raises a question on an arc and holds an increment on it, which a claim then finds waiting on the owner; it settles the question with his answer, which releases the increment; retiring a held question releases the increments held on it, naming them, and a record that is not a question is refused", async () => {
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

      const settled = await agent.call("settle_question", { question, answer: "Mailgun: its API is the simplest" });
      assert.equal(settled.isError, false, settled.text);
      assert.equal((await library.arcView(arc))?.questions.find((one) => one.id === question)?.fields.answer, "Mailgun: its API is the simplest");
      assert.deepEqual(await library.heldOnQuestion(welcome), [], "his answer released it");
      assert.equal((await agent.call("claim", { increment: welcome, reason: "driving it" })).isError, false);

      const receipt = await park("Receipt email");
      const wrong = idOf(await agent.call("raise_question", { ...asked, title: "Asked in error", holds: [receipt] }));
      assert.deepEqual(await library.heldOnQuestion(receipt), [wrong]);
      const retired = await agent.call("retire_question", { question: wrong, reason: "asked in error" });
      assert.equal(retired.isError, false, retired.text);
      assert.match(retired.text, new RegExp(`Released ${receipt}`));
      assert.deepEqual(retired.data.released, [receipt]);
      assert.equal((await library.arcView(arc))?.questions.some((one) => one.id === wrong), false, "retired");
      assert.deepEqual(await library.heldOnQuestion(receipt), [], "no longer held");
      assert.equal((await agent.call("claim", { increment: receipt, reason: "driving it" })).isError, false);

      const notAQuestion = await agent.call("retire_question", { question: welcome, reason: "asked in error" });
      assert.equal(notAQuestion.isError, true);
      assert.match(notAQuestion.text, /not a question/);
    });
  });
});

test("6.55 present_question marks a question as being put to the owner by the calling session; another live session is refused, naming it, and open flags it; done frees it, and a settled question is refused", async () => {
  await withProject(async ({ folder, log, project }) => {
    for (const session of ["claude-a", "claude-b"]) await log.append(project, { session, harness: "claude-code", source: "hook", kind: "session-started" });
    await withAgent(folder, claudeCode("claude-a"), async (a) => {
      await withAgent(folder, claudeCode("claude-b"), async (b) => {
        const { arc } = await planned(a);
        const question = idOf(await a.call("raise_question", { arc, title: "Which mailer?", stakes: "Cost", statement: "Mailgun or SES?", context: "Both work here", options: "Mailgun; SES" }));

        const presented = await a.call("present_question", { question });
        assert.equal(presented.isError, false, presented.text);
        const refused = await b.call("present_question", { question });
        assert.equal(refused.isError, true);
        assert.match(refused.text, /claude-a/, "it names the session putting it to the owner");
        const opened = await b.call("open", { id: question });
        assert.match(opened.text, /Being put to the owner by Claude Code session claude-a/);

        const done = await a.call("present_question", { question, done: true });
        assert.equal(done.isError, false, done.text);
        assert.doesNotMatch((await b.call("open", { id: question })).text, /Being put to the owner/);
        assert.equal((await b.call("present_question", { question })).isError, false, "free once A is done");

        await a.call("settle_question", { question, answer: "Mailgun" });
        const settled = await a.call("present_question", { question });
        assert.equal(settled.isError, true);
        assert.match(settled.text, /settled/);
      });
    });
  });
});

test("6.52 park_increment parks an increment born held on a question raised first, so a claim finds it waiting on the owner from the moment it is parked", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const question = idOf(await agent.call("raise_question", { arc, title: "Which mailer?", stakes: "Cost", statement: "Mailgun or SES?", context: "Both work here", options: "Mailgun; SES" }));
      const welcome = idOf(await agent.call("park_increment", { arc, title: "Welcome email", objective: "Send it", body: "Red then green", held_on: [question] }));
      assert.deepEqual(await library.heldOnQuestion(welcome), [question]);
      const refused = await agent.call("claim", { increment: welcome, reason: "driving it" });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /waiting on the owner/);
    });
  });
});

test("6.44 raising a question held on an increment the session holds, or a wait for the owner on it, releases its claims on it and the capabilities it took for it, and says so; claims on other work stand, and a question on another arc releases nothing (ADR-0944 D4)", async () => {
  await withProject(async ({ folder, library, log, project }) => {
    await withAgent(folder, claudeCode("asking"), async (agent) => {
      const { story, arc, capability } = await planned(agent);
      const other = idOf(await agent.call("plan_capability", { story, title: "Password reset", ...FOUNDED }));
      const elsewhere = idOf(await agent.call("plan_arc", { title: "Launch v2", intent: "Ship more", end_state: "More ships", stories: [story] }));
      const park = async (title: string) => idOf(await agent.call("park_increment", { arc, title, objective: `Build ${title}`, body: `${title}, red then green` }));
      const welcome = await park("Welcome email");
      const install = await park("Installer");
      const held = async () => (await readClaims(log, project)).map((one) => one.capability ?? one.increment).sort();
      for (const [kind, id] of [["capability", other], ["increment", welcome], ["capability", capability], ["increment", install]] as const) {
        assert.equal((await agent.call("claim", { [kind]: id, reason: "building it" })).isError, false);
      }
      const asked = { title: "Which mailer?", stakes: "Cost", statement: "Mailgun or SES?", context: "Both work here", options: "Mailgun; SES" };

      const away = await agent.call("raise_question", { ...asked, arc: elsewhere, holds: [welcome] });
      assert.equal(away.isError, false, away.text);
      assert.deepEqual(away.data?.released, [], "a question on another arc releases nothing");
      assert.deepEqual(await held(), [capability, other, welcome, install].sort());

      const raised = await agent.call("raise_question", { ...asked, arc, holds: [welcome] });
      assert.equal(raised.isError, false, raised.text);
      assert.deepEqual(raised.data?.released, [welcome, capability]);
      assert.match(raised.text, new RegExp(`Released your claims on ${welcome}, ${capability}`));
      assert.deepEqual(await held(), [other, install].sort(), "claims on other work stand");
      const refused = await agent.call("claim", { increment: welcome, reason: "back to it" });
      assert.match(refused.text, /waiting on the owner/, "it reads held on the owner, with no claim");

      const waited = await agent.call("set_wait", { waiter: install, for: "owner", note: "run the installer on the old laptop" });
      assert.deepEqual(waited.data?.released, [install]);
      assert.match(waited.text, new RegExp(`Released your claims on ${install}`));
      assert.deepEqual(await held(), [other]);
      assert.equal(((await library.get(install))?.fields as { status?: string } | undefined)?.status, "proposal", "nobody's work in progress");
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
      await write("claim", { increment, reason: "driving it" });
      for (const parked of [true, false]) await write("park_arc", { arc, parked });
      const blocker = await write("park_increment", { arc, title: "Mailer", objective: "Send mail", body: "Connect it" });
      await write("set_wait", { waiter: increment, on: blocker, reason: "Needs mail" });
      await write("clear_wait", { waiter: increment, on: blocker });
      const questionArgs = { arc, title: "Mailer?", stakes: "Delivery", statement: "Which?", context: "Signup", options: "Mailgun or SES" };
      // Holding the writer's own increment releases it, returning it to proposal: a third record (6.44).
      const question = await write("raise_question", { ...questionArgs, holds: [increment] }, 3);
      await write("correct_question", { question, stakes: "Cost and deliverability" });
      // Settling takes the question off the increment it held: a second record (12.3).
      await write("settle_question", { question, answer: "Mailgun" }, 2);
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

test("6.34 a call a hook saw works in the worktree that hook ran in, so a claim it takes carries that worktree's branch; a call no hook saw, or one whose hook ran in another project, works in the server's own folder", async () => {
  await withProject(async ({ folder, project, log }) => {
    git(folder, "init", "-b", "main");
    git(folder, "add", ".");
    git(folder, "commit", "-m", "first");
    // The session moved into a workspace after the harness started the tool server in the checkout.
    const worktree = path.join(folder, ".claude", "worktrees", "form");
    git(folder, "worktree", "add", "-q", "-b", "claude/form", worktree);
    const elsewhere = path.join(path.dirname(folder), "other");
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, MARKER_FILE), `${JSON.stringify({ project: uniqueProjectName() })}\n`);
    git(elsewhere, "init", "-b", "theirs");
    const hook = { session: "claude-1", harness: "claude-code", source: "hook", kind: "tool-requested", tool: "claim", agent: "orchestrator" } as const;
    await log.append(project, { ...hook, folder: worktree, call: "toolu_in_worktree" });
    await log.append(project, { ...hook, folder: elsewhere, call: "toolu_elsewhere" });
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { story, capability } = await planned(agent);
      const capabilityTitled = async (title: string) => idOf(await agent.call("plan_capability", { story, title, ...FOUNDED }));
      const [unseen, foreign] = [await capabilityTitled("Welcome mail"), await capabilityTitled("Password reset")];

      for (const [id, call] of [[capability, "toolu_in_worktree"], [unseen, undefined], [foreign, "toolu_elsewhere"]] as const) {
        const claimed = await agent.call("claim", { capability: id, reason: "building it" }, call === undefined ? undefined : { "claudecode/toolUseId": call });
        assert.equal(claimed.isError, false, claimed.text);
      }
      const branchOf = async (id: string) => (await readClaims(log, project)).find((claim) => claim.capability === id)?.branch;
      assert.equal(await branchOf(capability), "claude/form", "the worktree's branch, which its merge ends");
      assert.equal(await branchOf(unseen), "main", "no hook saw it: the server's own folder");
      assert.equal(await branchOf(foreign), "main", "a folder of another project is never worked in");
    });
  });
});

test("ADR-0650 writes proper artifact kinds, a quality control check among them, with default filing and refuses harness memory without writing", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("artifact-writer"), async (agent) => {
      const story = idOf(await agent.call("plan_story", { title: "Mail", ...FOUNDED }));
      const capability = idOf(await agent.call("plan_capability", { story, title: "Sender", ...FOUNDED }));
      await agent.call("claim", { capability, reason: "Build the sender" });
      const [cover] = await library.frontCovers(capability);
      const fields = { title: "Verify senders", description: "Check the sending domain", statement: "Verify before sending", why: "Mail must arrive", howToApply: "Verify the domain before enabling delivery" };
      const id = idOf(await agent.call("write_note", { kind: "principle", fields }));
      assert.deepEqual((await library.get(id))?.fields, { ...fields, links: [cover!.id] });
      const check = { title: "Senders verified", description: "A change that sends mail", question: "Does every new sender verify its domain first?", enforces: [id] };
      const checkId = idOf(await agent.call("write_note", { kind: "check", fields: check }));
      assert.deepEqual((await library.get(checkId))?.fields, { ...check, links: [cover!.id] });
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
          { id: capability.id, kind: "capability", spine: "1 · Postcode form", firstLine: "Takes a postcode" },
          { id: contract.id, kind: "contract", spine: "1.1 · Rejects a postcode with letters only", firstLine: "A bad postcode is refused" },
          { id: story.id, kind: "story", spine: "Visitor can sign up", firstLine: "A visitor leaves a postcode" },
        ],
      );
      assert.match(answer.text, /"1\.1 · Rejects a postcode with letters only" \(contract_\w+\): A bad postcode is refused/);
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

test("6.26 open on a contract shows it whole: its title, its description and the capability it belongs to; open on a question reads it whole with the increments held on it; an arc is still refused readably", async () => {
  await withProject(async ({ folder, library }) => {
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "Postcode form", story: story.id });
    const contract = await library.addContract({ title: "Rejects a postcode with letters only", capability: capability.id, description: "A bad postcode is refused" });
    const arc = await library.createArc({ title: "Signup release", intent: "Ship signup", endState: "Signup live" });

    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const opened = await agent.call("open", { id: contract.id });

      assert.equal(opened.isError, false);
      assert.match(opened.text, /Contract "1\.1 · Rejects a postcode with letters only" \(contract_\w+\):\nA bad postcode is refused/);
      assert.match(opened.text, new RegExp(`Capability "1 · Postcode form" \\(${capability.id}\\)`));
      assert.deepEqual(opened.data.contract, { id: contract.id, title: "1.1 · Rejects a postcode with letters only", description: "A bad postcode is refused", capability: { id: capability.id, title: "1 · Postcode form" } });

      const held = await library.addIncrement({ arc: arc.id, title: "Signup email", objective: "Send it", body: "Red then green" });
      const question = await library.raiseQuestion({ arc: arc.id, title: "Which mailer?", stakes: "Cost and deliverability", statement: "Send through Mailgun or SES?", context: "Both work here", options: "Mailgun; SES", recommendation: "Mailgun" });
      await library.editIncrement(held.id, { heldOn: [question.id] });
      const read = await agent.call("open", { id: question.id });
      assert.equal(read.isError, false, read.text);
      assert.match(read.text, new RegExp(`Question "Which mailer\\?" \\(${question.id}\\)`));
      for (const words of [/Cost and deliverability/, /Send through Mailgun or SES\?/, /Both work here/, /Mailgun; SES/, /Recommendation: Mailgun/, new RegExp(`Holding: ${held.id}`), new RegExp(`On ${arc.id}, open`)]) assert.match(read.text, words);
      assert.deepEqual((read.data.question as { holding: string[] }).holding, [held.id]);

      const refused = await agent.call("open", { id: arc.id });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /is an arc/);
    });
  });
});

test("6.28 move_increment moves open work with its claim and completed history with its outcome; open work into a closed arc, missing arcs and missing increments are refused", async () => {
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
      const historyMove = await agent.call("move_increment", { increment: done, to: closedArc, reason: "separate the completed phase" });
      assert.equal(historyMove.isError, false, historyMove.text);
      const completed = (await library.arcView(closedArc))?.increments.find(({ id }) => id === done);
      assert.equal(completed?.fields.status, "closed");
      assert.equal(completed?.fields.outcome?.pr, "#2");
      for (const [args, why] of [
        [{ increment, to: closedArc, reason: "r" }, "a closed arc"],
        [{ increment, to: "arc_000000000000", reason: "r" }, "a missing arc"],
        [{ increment: "increment_000000000000", to: arc, reason: "r" }, "a missing increment"],
      ] as const) {
        const refused = await agent.call("move_increment", args);
        assert.equal(refused.isError, true, `${why} is refused: ${refused.text}`);
      }
      assert.ok((await ids(target)).includes(increment) && !(await ids(target)).includes(done), "only completed history moved");
    });
  });
});

test("6.46 add_remedies adds live friction to a parked increment's remedies, keeping those it had, so a tool route accepts it; friction that is not live, or no increment, is refused with nothing written", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc } = await planned(agent);
      const friction = (title: string) => recordFriction(library, { title, description: "Delay", statement: "Timeout", evidence: "src/mail.ts: TimeoutError", impact: "Readers wait" });
      const first = await friction("Slow mail");
      const later = await friction("Slow mail again");
      const fix = (await library.addIncrement({ arc, title: "Retry mail", objective: "Retry", body: "Red then green", remedies: [first.id] })).id;

      const history = await library.history({ id: fix });
      for (const args of [{ increment: fix, frictions: ["friction_000000000000"] }, { increment: "increment_000000000000", frictions: [later.id] }]) {
        const refused = await agent.call("add_remedies", args);
        assert.equal(refused.isError, true, refused.text);
      }
      assert.deepEqual(await library.history({ id: fix }), history, "nothing was written");

      const added = await agent.call("add_remedies", { increment: fix, frictions: [later.id, first.id] });
      assert.equal(added.isError, false, added.text);
      assert.deepEqual(((await library.get(fix))?.fields as { remedies?: string[] } | undefined)?.remedies, [first.id, later.id]);
      assert.equal((await route(library, later.id, "tool", "Its fix is parked")).fields.route, "tool");
    });
  });
});

test("6.47 park_increment takes an increment's capabilities and links, and edit_plan replaces either after parking; a story given as a capability is refused with nothing written (ADR-0949 D2)", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc, story, capability } = await planned(agent);
      const fieldsOf = async (id: string) => (await library.get(id))?.fields as { capabilities?: string[]; links?: string[] };
      const parked = await agent.call("park_increment", { arc, title: "Email form", objective: "Build it", body: "Red then green", links: [story] });
      assert.equal(parked.isError, false, parked.text);
      const increment = idOf(parked);
      assert.deepEqual([(await fieldsOf(increment)).capabilities, (await fieldsOf(increment)).links], [undefined, [story]], "parked with the list empty");

      const history = await library.history({ id: increment });
      const refused = await agent.call("edit_plan", { id: increment, capabilities: [story] });
      assert.equal(refused.isError, true, refused.text);
      assert.equal((await agent.call("park_increment", { arc, title: "Bad", objective: "Bad", body: "Bad", capabilities: [story] })).isError, true);
      assert.deepEqual(await library.history({ id: increment }), history, "nothing was written");

      const filled = await agent.call("edit_plan", { id: increment, capabilities: [capability] });
      assert.equal(filled.isError, false, filled.text);
      assert.deepEqual([(await fieldsOf(increment)).capabilities, (await fieldsOf(increment)).links], [[capability], [story]], "the claiming session fills it; the links stay");
    });
  });
});

test("6.51 edit_plan sets and clears an arc's priority, refusing anything but a whole number of 1 or more or \"none\" with nothing written, and show_plan lists arcs by it, 1 first (ADR-0963)", async () => {
  await withProject(async ({ folder, library }) => {
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      const { arc: unranked } = await planned(agent);
      const ranked = idOf(await agent.call("plan_arc", { title: "Ranked arc", intent: "Go first", end_state: "Done first" }));
      const set = await agent.call("edit_plan", { id: ranked, priority: 2 });
      assert.equal(set.isError, false, set.text);
      assert.equal(((await library.get(ranked))?.fields as { priority?: number } | undefined)?.priority, 2);

      const history = await library.history({ id: ranked });
      for (const wrong of [0, 1.5, "first"]) assert.equal((await agent.call("edit_plan", { id: ranked, priority: wrong })).isError, true, `priority ${wrong} was taken`);
      assert.deepEqual(await library.history({ id: ranked }), history, "nothing was written");

      const plan = await agent.call("show_plan");
      const arcLines = plan.text.split("\n").filter((line) => line.startsWith("Arc "));
      assert.deepEqual(arcLines.map((line) => [ranked, unranked].find((id) => line.includes(id))), [ranked, unranked], plan.text);
      assert.match(arcLines[0]!, /priority 2/);

      assert.equal((await agent.call("edit_plan", { id: ranked, priority: "none" })).isError, false);
      assert.equal(((await library.get(ranked))?.fields as { priority?: number } | undefined)?.priority, undefined);
    });
  });
});

test("6.48 edit_plan refuses an increment's capabilities list a capability already on the list of another live session's claimed increment, naming that increment and its holder, with nothing written; the same session's own lists, and a list whose increment is released, are not refused (ADR-0949 D2)", async () => {
  await withProject(async ({ folder, library }) => {
    const capabilitiesOf = async (id: string) => ((await library.get(id))?.fields as { capabilities?: string[] }).capabilities;
    let theirs = "";
    let capability = "";
    let arc = "";
    let mine = "";
    let own = "";
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      ({ arc, capability } = await planned(agent));
      theirs = idOf(await agent.call("park_increment", { arc, title: "Email form", objective: "Build it", body: "Red then green" }));
      assert.equal((await agent.call("claim", { increment: theirs, reason: "driving the email form" })).isError, false);
      assert.equal((await agent.call("edit_plan", { id: theirs, capabilities: [capability] })).isError, false);
      own = idOf(await agent.call("park_increment", { arc, title: "Form polish", objective: "Polish it", body: "Red then green" }));
      assert.equal((await agent.call("claim", { increment: own, reason: "polishing the form" })).isError, false);
      const shared = await agent.call("edit_plan", { id: own, capabilities: [capability] });
      assert.equal(shared.isError, false, `a session's own two lists may share: ${shared.text}`);
    });
    await withAgent(folder, codex("codex-1"), async (agent) => {
      mine = idOf(await agent.call("park_increment", { arc, title: "Form copy", objective: "Reword it", body: "Red then green" }));
      assert.equal((await agent.call("claim", { increment: mine, reason: "rewording the form" })).isError, false);
      const history = await library.history({ id: mine });
      const refused = await agent.call("edit_plan", { id: mine, capabilities: [capability] });
      assert.equal(refused.isError, true, refused.text);
      assert.ok(refused.text.includes(theirs) && refused.text.includes("claude-1") && refused.text.includes(capability), refused.text);
      assert.deepEqual(await library.history({ id: mine }), history, "nothing was written");
    });
    await withAgent(folder, claudeCode("claude-1"), async (agent) => {
      for (const increment of [theirs, own]) assert.equal((await agent.call("release", { increment })).isError, false);
    });
    await withAgent(folder, codex("codex-1"), async (agent) => {
      const allowed = await agent.call("edit_plan", { id: mine, capabilities: [capability] });
      assert.equal(allowed.isError, false, allowed.text);
      assert.deepEqual(await capabilitiesOf(mine), [capability]);
    });
  });
});

test("6.39 a tool call's reads do not grow with the log's length: the same calls (show the plan, claim, read the context, release) take about as much from the store in a project whose log holds weeks of history as in one whose log holds an hour's", { timeout: 120_000 }, async (t) => {
  const taken: number[] = [];
  let history = 0;
  for (const long of [false, true]) {
    // Each phase is a subtest, so a unit killed at its deadline names the phase still running.
    const which = long ? "weeks of log" : "an hour of log";
    await withProject(async ({ folder, project, library, log }) => {
      let emailForm = "";
      await t.test(`${which}: the project and its log are written`, async () => {
        const story = await library.addStory({ title: "Visitor can sign up" });
        emailForm = (await library.addCapability({ title: "Email form", story: story.id })).id;
        // The same last hour in both: this session and another one working.
        for (const session of ["cc-1", "cc-2"]) {
          await log.append(project, { session, harness: "claude-code", source: "hook", folder, kind: "session-started", how: "startup", transcript: path.join(folder, `${session}.jsonl`) });
          await log.append(project, { session, harness: "claude-code", source: "hook", folder, kind: "command-run", command: "pnpm test", call: `${session}-call` });
        }
        if (long) history = await longHistory(project, folder, 400, hostname().trim());
      });
      const store = await countingStore();
      try {
        await t.test(`${which}: the calls answer through a counting store`, async () => {
          const dataDir = path.join(folder, "..", "counted", "pgdata");
          mkdirSync(path.dirname(dataDir), { recursive: true });
          placeTestServer(dataDir, { port: store.port });
          await approveCheckout(folder, project, path.dirname(dataDir));
          await withAgent(folder, claudeCode("cc-1", { dataDir }), async (agent) => {
            for (const [tool, args] of [["show_plan", {}], ["claim", { capability: emailForm, reason: "building it" }], ["read_context", {}], ["release", { capability: emailForm }]] as const) {
              const answer = await agent.call(tool, args);
              assert.equal(answer.isError, false, `${tool}: ${answer.text}`);
            }
          });
        });
        await t.test(`${which}: the store goes quiet`, async () => {
          await store.settled(500, 30_000);
          taken.push(store.received());
        });
      } finally {
        await store.close();
      }
    });
  }
  assert.ok(history > 20_000_000, `the long history is weeks' worth: ${history} bytes`);
  assert.ok(taken[1]! - taken[0]! < 128 * 1024, `the calls took ${taken[0]} bytes from a short log and ${taken[1]} from one ${history} bytes longer: no more than 128 KiB apart`);
});
