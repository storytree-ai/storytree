/**
 * Capability 5 · Claims: contract 5.36, a question put to the owner is marked with the session
 * putting it, so a second live session is turned away from it, against the real Postgres `pnpm test`
 * provides, in a fresh project dropped afterwards.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "@storytree/library";

import { openActivityLog } from "../activity/index.js";
import { closeOut } from "../sessions/index.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { presentQuestion, presentersOf, stopPresenting } from "./presenting.js";

test("5.36 a question one live session is putting to the owner is refused to another, naming it, and listed as presented; it is free again once that session stops, ends or closes out, and settling it clears it", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor gets mail" });
    const arc = await library.createArc({ title: "Email", intent: "Send mail", endState: "Mail is sent", stories: [story.id] });
    const ask = { arc: arc.id, stakes: "Cost", statement: "Which provider?", context: "We send mail", options: "Mailgun or SES" };
    const question = (await library.raiseQuestion({ ...ask, title: "Provider" })).id;
    const other = (await library.raiseQuestion({ ...ask, title: "Sender name" })).id;
    const as = (session: "A" | "B") => ({ log, library, project, session, harness: session === "A" ? "claude-code" : "codex" });
    for (const session of ["A", "B"] as const) await log.append(project, { session, harness: as(session).harness, source: "hook", kind: "session-started" });

    assert.equal((await presentQuestion(as("A"), question)).ok, true);
    assert.equal((await presentQuestion(as("A"), question)).ok, true, "presenting it again changes nothing");
    const refused = await presentQuestion(as("B"), question);
    assert.ok(!refused.ok && refused.refused === "presenting");
    assert.deepEqual({ session: refused.presenter.session, label: refused.presenter.label }, { session: "A", label: "Claude Code" });
    assert.deepEqual([...(await presentersOf(log, project, await library.list("question"))).entries()].map(([id, by]) => [id, by.session]), [[question, "A"]]);

    assert.equal(await stopPresenting(as("B"), question), false, "only its presenter stops presenting it");
    assert.equal(await stopPresenting(as("A"), question), true);
    assert.equal((await presentQuestion(as("B"), question)).ok, true, "free once A stops");

    await log.append(project, { session: "B", source: "hook", kind: "session-ended" });
    assert.deepEqual((await presentersOf(log, project, await library.list("question"))).size, 0, "an ended session presents nothing");
    assert.equal((await presentQuestion(as("A"), question)).ok, true, "free once B ends");

    await closeOut(as("A"), { safe: false, why: "done for now" });
    assert.equal((await presentersOf(log, project, await library.list("question"))).size, 0, "a closed-out session presents nothing");
    await log.append(project, { session: "A", source: "hook", kind: "prompt-submitted" });

    assert.equal((await presentQuestion(as("A"), other)).ok, true, "another question is A's to present");
    await library.settleQuestion(other, { answer: "Storytree" });
    const settled = await presentQuestion(as("B"), other);
    assert.ok(!settled.ok && settled.refused === "settled", "a settled question is no longer put to him");
    assert.ok(!(await presentQuestion(as("B"), "question_000000000000")).ok);
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
});
