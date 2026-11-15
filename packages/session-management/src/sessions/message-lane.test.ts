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
import { VerbRefusal, type DoorWords } from "@storytree/library/verbs";

import { claim } from "../claims/claims.js";
import { deliveryText, messageLane } from "./message-lane.js";
import { SESSION_VERBS } from "./verbs.js";

/** The command line's words for the steps a verb names. */
const COMMAND: DoorWords = { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` };

/** A project with an increment the session "lane" holds, beating as a pool lane (a Claude Code lane's) or, for `codex`, with no beat; `work` runs with it and is cleaned up after. */
async function withLane(work: (on: { project: string; increment: string; log: Awaited<ReturnType<typeof openActivityLog>>; library: Awaited<ReturnType<Awaited<ReturnType<typeof connect>>["openProject"]>> }) => Promise<void>, harness: "claude-code" | "codex" = "claude-code"): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor gets mail" });
    const arc = await library.createArc({ title: "Email", intent: "Send mail", endState: "Mail is sent", stories: [story.id] });
    const increment = (await library.addIncrement({ arc: arc.id, title: "Send it", objective: "Send mail", body: "Promise: mail is sent." })).id;
    await log.append(project, { session: "lane", harness, source: "hook", kind: "session-started" });
    const held = await claim({ log, library, project, session: "lane", harness }, increment, "build it");
    assert.equal(held.ok, true);
    if (harness === "claude-code") await log.beats.beat(project, "lane", { lane: true });
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

    // Either door: the message verb queues, refuses a mode it does not know or an empty message as misuse, and passes on the work's refusals.
    const verb = SESSION_VERBS.find((one) => "name" in one.tool && one.tool.name === "message_lane")!;
    const doorContext = { ...owner, harness: "claude-code", folder: "/work/owner" };
    const queued = await verb.act({ increment, mode: "steer", text: "Through the door." }, doorContext, COMMAND);
    assert.equal(queued.text, `Queued for the lane on ${increment} (session lane): after its current tool call.`);
    assert.deepEqual((await log.messages.take(project, "lane", "tool")).map((one) => one.text), ["Through the door."]);
    await assert.rejects(verb.act({ increment, mode: "shout", text: "x" }, doorContext, COMMAND), (error: unknown) => error instanceof VerbRefusal && error.misuse && /steer, follow-up, note/.test(error.message));
    await assert.rejects(verb.act({ increment, mode: "steer", text: " " }, doorContext, COMMAND), (error: unknown) => error instanceof VerbRefusal && error.misuse);
    await assert.rejects(verb.act({ increment: "increment_none", mode: "steer", text: "x" }, doorContext, COMMAND), (error: unknown) => error instanceof VerbRefusal && !error.misuse && /No session holds increment_none/.test(error.message));

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

test("4.52 · A Codex pool lane, which keeps no heartbeat, takes messages once its hooks mark it a lane: while its claim binds and its lines say it has not ended, a steer or follow-up is queued for it and a note written; unmarked it is no lane, and once it ended or went quiet it is refused as ended", async () => {
  await withLane(async ({ project, increment, log, library }) => {
    const owner = { log, library, project, session: "owner-terminal" };
    const send = (mode: "steer" | "follow-up" | "note", text: string, now?: Date) => messageLane(owner, { increment, mode, text, ...(now === undefined ? {} : { now }) });
    assert.deepEqual(await send("steer", "Use the SES client."), { ok: false, refused: "not-a-lane", session: "lane" }, "a Codex session its hooks never marked is no lane");

    await log.messages.mark(project, "lane");
    assert.equal(await log.messages.marked(project, "lane"), true);
    assert.equal((await log.beats.of(project, ["lane"])).get("lane"), undefined, "the mark is no beat: it never judges whether the lane lives");
    assert.deepEqual(await send("steer", "Use the SES client."), { ok: true, lane: "lane", mode: "steer" });
    assert.deepEqual(await send("follow-up", "Then write the docs."), { ok: true, lane: "lane", mode: "follow-up" });
    assert.deepEqual(await send("note", "The SES quota went up today."), { ok: true, lane: "lane", mode: "note" });
    assert.deepEqual((await log.messages.take(project, "lane", "stop")).map((one) => one.text), ["Use the SES client.", "Then write the docs."]);

    assert.deepEqual(await send("steer", "late", new Date(Date.now() + 2 * 24 * 60 * 60_000)), { ok: false, refused: "ended", session: "lane" }, "a lane quiet past its claim's quiet time has ended");
    await log.append(project, { session: "lane", harness: "codex", source: "hook", kind: "session-ended" });
    assert.deepEqual(await send("steer", "after its end"), { ok: false, refused: "ended", session: "lane" });
    assert.deepEqual(await log.messages.take(project, "lane", "stop"), [], "nothing refused was queued");
  }, "codex");
});
