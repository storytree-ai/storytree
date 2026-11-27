import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "../../index.js";

import { withLibrary } from "../../testing/pg.js";
import { librarianTools, type ToolAnswer, type ToolCall } from "./index.js";


async function shelf(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const capability = await library.addCapability({ title: "Email form", story: story.id });
  const cover = await library.recordDecision({ title: "Send through Mailgun", text: "Mailgun: the simplest API.", status: "accepted", frontCoverOf: capability.id, loadBearing: true });
  return { capability, cover };
}

async function textsOf(library: Library, id: string): Promise<unknown[]> {
  return (await library.changesSince(0)).changes.filter((change) => change.recordId === id).map((change) => change.record.fields.text);
}

test("13.12 supersede accepts an existing successor through the tool, preserving its history and links without making a duplicate", async () => {
  await withLibrary(async (library) => {
    const { capability, cover } = await shelf(library);
    const earlier = await library.recordDecision({ title: "Send nothing", text: "No email yet.", status: "accepted" });
    const successor = await library.recordDecision({
      title: "Send through Postmark", text: "Postmark replaces Mailgun.", status: "accepted", supersedes: [earlier.id], links: [earlier.id], justifications: { [earlier.id]: "Postmark replaces sending nothing." },
      authority: { basis: "owner-directed", ownerSaid: "Use Postmark", scribedBy: "owner", at: "2026-10-06T00:00:00.000Z" },
    });
    const before = (await library.changesSince(0)).cursor;
    const call: ToolCall = { library, project: library.name, folder: ".", caller: { session: "curator" }, writer: { actor: "curator" }, log: { lines: async () => [] } };
    let invoke: (() => Promise<ToolAnswer>) | undefined;
    librarianTools().registerTools!((name, _description, input, act) => {
      if (name === "supersede") invoke = () => act(input.parse({ olds: [cover.id, earlier.id, cover.id], successor: successor.id, justifications: { [cover.id]: "Postmark replaces Mailgun." } }), call);
    });
    assert.ok(invoke);

    const answer = await invoke();

    assert.equal(answer.data?.id, successor.id);
    assert.deepEqual((await library.get(successor.id))?.fields, {
      ...successor.fields, supersedes: [earlier.id, cover.id], frontCoverOf: capability.id, loadBearing: true,
      justifications: { [earlier.id]: "Postmark replaces sending nothing.", [cover.id]: "Postmark replaces Mailgun." },
    });
    assert.deepEqual((await library.list("decision")).map(({ id }) => id).sort(), [cover.id, earlier.id, successor.id].sort());
    for (const id of [cover.id, earlier.id]) {
      const old = await library.decision(id);
      assert.equal(old?.status, "superseded");
      assert.deepEqual(old?.supersededBy, [successor.id]);
    }
    assert.notEqual((await library.decision(cover.id))?.record.fields.loadBearing, true);
    assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [successor.id]);
    assert.deepEqual(await textsOf(library, successor.id), [successor.fields.text, successor.fields.text]);
    assert.ok((await library.history({ since: before })).every(({ actor }) => actor === "curator"));
  });
});
