import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "../../index.js";

import { withLibrary } from "../../testing/pg.js";
import { supersede } from "./index.js";


async function shelf(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const capability = await library.addCapability({ title: "Email form", story: story.id });
  const cover = await library.recordDecision({ title: "Send through Mailgun", text: "Mailgun: the simplest API.", status: "accepted", frontCoverOf: capability.id, loadBearing: true });
  return { capability, cover };
}

async function textsOf(library: Library, id: string): Promise<unknown[]> {
  return (await library.changesSince(0)).changes.filter((change) => change.recordId === id).map((change) => change.record.fields.text);
}

test("13.12 supersede records an accepted successor that takes the old one's shelf and load-bearing mark, and the old one stays readable as superseded", async () => {
  await withLibrary(async (library) => {
    const { capability, cover } = await shelf(library);
    const other = await library.recordDecision({ title: "Log every email", text: "Every email sent is logged.", status: "accepted" });

    const successor = await supersede(library, [cover.id, other.id], { title: "Send through Postmark", text: "Postmark, with its logs, replaces Mailgun." }, undefined, { [cover.id]: "Postmark replaces Mailgun.", [other.id]: "Postmark keeps the logs." });

    assert.equal(successor.fields.status, "accepted");
    assert.deepEqual(successor.fields.supersedes, [cover.id, other.id]);
    assert.deepEqual((await library.frontCovers(capability.id)).map((decision) => decision.id), [successor.id]);
    assert.equal((await library.decision(successor.id))?.record.fields.loadBearing, true);
    const old = await library.decision(cover.id);
    assert.equal(old?.status, "superseded");
    assert.equal(old?.record.fields.text, "Mailgun: the simplest API.");
    assert.notEqual(old?.record.fields.loadBearing, true);
  });
});

test("13.12 an existing successor keeps its own shelf and load-bearing mark when another decision is added", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const { capability, cover: successor } = await shelf(library);
    await supersede(library, [cover.id], successor.id, undefined, { [cover.id]: "The newer cover replaces it." });
    await supersede(library, [cover.id], successor.id);
    assert.deepEqual((await library.get(successor.id))?.fields, { ...successor.fields, supersedes: [cover.id], justifications: { [cover.id]: "The newer cover replaces it." } });
    assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [successor.id]);
  });
});

test("13.12 existing supersession refuses invalid decisions and loops before any write", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const proposal = await library.recordDecision({ title: "Proposal", text: "Maybe.", status: "proposed" });
    const retired = await library.recordDecision({ title: "Retired", text: "Gone.", status: "accepted" });
    await library.retire(retired.id, "Wrongly recorded");
    const definition = await library.defineTerm({ term: "Email", meaning: "A message." });
    await library.recordDecision({ title: "Successor", text: "Replaces Mailgun.", status: "accepted", supersedes: [cover.id], justifications: { [cover.id]: "It replaces Mailgun." } });
    const current = await library.recordDecision({ title: "Current", text: "Independent decision.", status: "accepted" });
    await library.editNote(proposal.id, { supersedes: [current.id], justifications: { [current.id]: "The proposal would replace it." } });
    const { cursor } = await library.changesSince(0);
    for (const id of ["decision_missing", retired.id, definition.id, proposal.id, cover.id]) {
      await assert.rejects(supersede(library, [current.id], id, undefined, { [current.id]: "Refused before it is written." }), /live.*decision|accepted/);
    }
    for (const id of ["decision_missing", retired.id, definition.id]) {
      await assert.rejects(supersede(library, [id], current.id, undefined, { [id]: "Refused before it is written." }), /supersedes.*decision/);
    }
    await assert.rejects(supersede(library, [current.id], current.id, undefined, { [current.id]: "A loop, refused." }), /supersession loop/);
    await assert.rejects(supersede(library, [proposal.id], current.id, undefined, { [proposal.id]: "A loop, refused." }), /supersession loop/);
    assert.equal((await library.decision(cover.id))?.record.fields.loadBearing, true);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("13.13 a supersede that fails part-way leaves neither the successor nor the old decision changed", async () => {
  await withLibrary(async (library) => {
    const { capability, cover } = await shelf(library);
    const { cursor } = await library.changesSince(0);
    let asked = 0;
    const failing = { actor: "curator", outsideRead: async () => {
      asked += 1;
      if (asked > 1) throw new Error("the connection dropped");
      return [];
    } };

    await assert.rejects(supersede(library, [cover.id], { title: "Send through Postmark", text: "Postmark replaces Mailgun." }, failing, { [cover.id]: "Postmark replaces Mailgun." }), /connection dropped/);

    assert.equal(asked, 2, "it failed after the successor's write, before the old decision's");
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");
    assert.equal((await library.decision(cover.id))?.record.fields.loadBearing, true);
    assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [cover.id]);
  });
});
