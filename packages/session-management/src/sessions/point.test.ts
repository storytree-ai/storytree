/**
 * Capability 4 · Sessions: contract 4.43, a session points at one capability where the owner's eye is needed, against
 * the real Postgres `pnpm test` provides, in a fresh project. Read back from the whole log and from the bounded read.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { openActivityLog } from "../activity/index.js";
import { closeOut } from "./close-out.js";
import { readSessions, sessionsFrom } from "./index.js";
import { pointAt } from "./point.js";

test("4.43 · a session points at one capability, saying why and, optionally, the question it is for; the latest point replaces the earlier one, and pointing at nothing, closing out or ending removes it; an id that is not a capability, an empty why or a non-question id is refused", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor gets mail" });
    const send = await library.addCapability({ story: story.id, title: "Send" });
    const bounce = await library.addCapability({ story: story.id, title: "Bounce" });
    const arc = await library.createArc({ title: "Email", intent: "Send mail", endState: "Mail is sent", stories: [story.id] });
    const question = (await library.raiseQuestion({ arc: arc.id, title: "Provider", stakes: "Cost", statement: "Which provider?", context: "We send mail", options: "Mailgun or SES" })).id;
    const as = (session: string) => ({ log, library, project, session, harness: "claude-code" });
    for (const session of ["A", "B"]) await log.append(project, { session, harness: "claude-code", source: "hook", kind: "session-started" });
    const pointerOf = async (session: string) => {
      const whole = sessionsFrom((await log.since(project, 0)).lines).find((one) => one.session === session)?.pointer;
      const bounded = (await readSessions(log, project, { of: [session] })).find((one) => one.session === session)?.pointer;
      assert.deepEqual(bounded, whole, "the bounded read keeps the pointer the whole log gives");
      return whole === undefined ? undefined : { capability: whole.capability, why: whole.why, ...(whole.question === undefined ? {} : { question: whole.question }) };
    };

    await log.append(project, { session: "A", harness: "claude-code", source: "tool", kind: "session-named", title: "Reading mail" });
    assert.equal((await pointAt(as("A"), { capability: send.id, why: "A picture to judge" })).ok, true);
    await log.append(project, { session: "A", harness: "claude-code", source: "tool", kind: "session-named", title: "Building mail" });
    await log.append(project, { session: "A", harness: "claude-code", source: "tool", kind: "session-named", title: "Still building mail" });
    assert.deepEqual(await pointerOf("A"), { capability: send.id, why: "A picture to judge" });
    assert.equal(await pointerOf("B"), undefined, "one session's point is its own");

    assert.equal((await pointAt(as("A"), { capability: bounce.id, why: "Your call on bounces", question })).ok, true);
    assert.deepEqual(await pointerOf("A"), { capability: bounce.id, why: "Your call on bounces", question }, "the latest point replaces the earlier");

    assert.equal((await pointAt(as("A"), {})).ok, true);
    assert.equal(await pointerOf("A"), undefined, "pointing at nothing removes it");

    assert.deepEqual(await pointAt(as("A"), { capability: story.id, why: "Look" }), { ok: false, refused: "not-a-capability", id: story.id });
    assert.deepEqual(await pointAt(as("A"), { capability: send.id, why: "  " }), { ok: false, refused: "no-why" });
    assert.deepEqual(await pointAt(as("A"), { capability: send.id, why: "Look", question: arc.id }), { ok: false, refused: "not-a-question", id: arc.id });
    assert.equal(await pointerOf("A"), undefined, "a refused point points at nothing");

    await pointAt(as("A"), { capability: send.id, why: "Look" });
    await closeOut(as("A"), { safe: true, why: "done" }, { look: {} });
    assert.equal(await pointerOf("A"), undefined, "closing out removes it");

    await pointAt(as("B"), { capability: send.id, why: "Look" });
    await log.append(project, { session: "B", harness: "claude-code", source: "hook", kind: "session-ended" });
    assert.equal(await pointerOf("B"), undefined, "ending removes it");
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
});
