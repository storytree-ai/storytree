/**
 * Capability 4 · Sessions: contracts 4.49 to 4.51, a message to a running pool lane (increment_783a63fe5b16), against the real
 * Postgres `pnpm test` provides, in a fresh project. The lane is the session holding the increment's claim whose harness beats
 * as a lane; a steer is taken at its next tool call's end, a follow-up at its turn's end, a note written on its increment.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { openActivityLog } from "../activity/index.js";
import { claim } from "../claims/claims.js";
import { deliveryText, messageLane } from "./message-lane.js";

/** A project with an increment the session "lane" holds, beating as a pool lane; `work` runs with it and is cleaned up after. */
async function withLane(work: (on: { project: string; increment: string; log: Awaited<ReturnType<typeof openActivityLog>>; library: Awaited<ReturnType<Awaited<ReturnType<typeof connect>>["openProject"]>> }) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor gets mail" });
    const arc = await library.createArc({ title: "Email", intent: "Send mail", endState: "Mail is sent", stories: [story.id] });
    const increment = (await library.addIncrement({ arc: arc.id, title: "Send it", objective: "Send mail", body: "Promise: mail is sent." })).id;
    await log.append(project, { session: "lane", harness: "claude-code", source: "hook", kind: "session-started" });
    const held = await claim({ log, library, project, session: "lane", harness: "claude-code" }, increment, "build it");
    assert.equal(held.ok, true);
    await log.beats.beat(project, "lane", { lane: true });
    await work({ project, increment, log, library });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
}

test("4.49 · A message to a running pool lane is queued against the session holding its increment and taken once: a steer at the lane's next tool call's end, a follow-up (with any steer still waiting) only at its turn's end, in the order sent, naming who sent it", async () => {
  await withLane(async ({ project, increment, log, library }) => {
    const owner = { log, library, project, session: "owner-terminal" };
    assert.deepEqual(await messageLane(owner, { increment, mode: "follow-up", text: "Then write the docs." }), { ok: true, lane: "lane", mode: "follow-up" });
    assert.deepEqual(await messageLane(owner, { increment, mode: "steer", text: "Use the SES client." }), { ok: true, lane: "lane", mode: "steer" });

    const steers = await log.messages.take(project, "lane", "tool");
    assert.deepEqual(steers.map((one) => [one.mode, one.text, one.sender]), [["steer", "Use the SES client.", "owner-terminal"]], "a tool call's end takes the steer, not the follow-up");
    assert.deepEqual(await log.messages.take(project, "lane", "tool"), [], "taken once");
    assert.match(deliveryText(steers), /owner-terminal[\s\S]*Use the SES client\./, "the text the lane is given names the sender and carries the words");

    await messageLane(owner, { increment, mode: "steer", text: "Keep the old template." });
    const atEnd = await log.messages.take(project, "lane", "stop");
    assert.deepEqual(atEnd.map((one) => one.text), ["Then write the docs.", "Keep the old template."], "the turn's end takes the follow-up and a steer still waiting, in the order sent");
    assert.deepEqual(await log.messages.take(project, "lane", "stop"), []);

    // Two takes at once never both deliver one message.
    for (const text of ["one", "two", "three"]) await messageLane(owner, { increment, mode: "steer", text });
    const [first, second] = await Promise.all([log.messages.take(project, "lane", "tool"), log.messages.take(project, "lane", "tool")]);
    assert.deepEqual([...first, ...second].map((one) => one.text).sort(), ["one", "three", "two"]);
    assert.deepEqual(await log.messages.take(project, "other-session", "stop"), [], "another session takes none of the lane's messages");
  });
});

test("4.50 · A message that cannot reach a running pool lane is refused with the reason and queues nothing: no session holds the increment, its holder does not beat as a lane, the lane has ended or stopped beating, the text is empty, or the sender's session has read outside text", async () => {
  await withLane(async ({ project, increment, log, library }) => {
    const from = (session: string) => ({ log, library, project, session });
    const steer = (session: string, text = "Use the SES client.", to = increment) => messageLane(from(session), { increment: to, mode: "steer", text });

    const arc = (await library.list("arc"))[0]!.id;
    const unheld = (await library.addIncrement({ arc, title: "Bounce it", objective: "See bounces", body: "Promise: bounces are seen." })).id;
    assert.deepEqual(await steer("owner-terminal", "x", unheld), { ok: false, refused: "no-lane", increment: unheld });
    assert.deepEqual(await steer("owner-terminal", "   "), { ok: false, refused: "empty" });

    // A session that read an issue may not pass its words on to an unattended lane.
    await log.append(project, { session: "reader", harness: "claude-code", source: "hook", kind: "outside-text-read", what: "github issue #12" });
    assert.deepEqual(await steer("reader"), { ok: false, refused: "outside-text", reads: ["github issue #12"] });

    await log.beats.beat(project, "lane");
    assert.deepEqual(await steer("owner-terminal"), { ok: false, refused: "not-a-lane", session: "lane" }, "an interactive session holding it is no lane");
    await log.beats.beat(project, "lane", { lane: true, ended: true });
    assert.deepEqual(await steer("owner-terminal"), { ok: false, refused: "ended", session: "lane" });
    await log.beats.beat(project, "lane", { lane: true });
    assert.deepEqual(await messageLane(from("owner-terminal"), { increment, mode: "steer", text: "late", now: new Date(Date.now() + 5 * 60_000) }), { ok: false, refused: "ended", session: "lane" }, "a lane whose beats stopped has ended");

    assert.deepEqual(await log.messages.take(project, "lane", "stop"), [], "nothing refused was queued");
  });
});

test("4.51 · A note to a running pool lane is written on its increment, naming who sent it, and never handed to the lane's model", async () => {
  await withLane(async ({ project, increment, log, library }) => {
    assert.deepEqual(await messageLane({ log, library, project, session: "owner-terminal" }, { increment, mode: "note", text: "The SES quota went up today." }), { ok: true, lane: "lane", mode: "note" });
    const body = ((await library.get(increment))?.fields as { body?: string }).body ?? "";
    assert.ok(body.startsWith("Promise: mail is sent."), "the body it had is kept");
    assert.match(body, /owner-terminal[\s\S]*The SES quota went up today\./);
    assert.deepEqual(await log.messages.take(project, "lane", "stop"), [], "the model is not asked");
  });
});
