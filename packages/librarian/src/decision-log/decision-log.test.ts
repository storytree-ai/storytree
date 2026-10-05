/**
 * Capability 2 · Decision log: one test per contract 2.1-2.4 in the librarian story, each in a
 * fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import type { ToolAnswer, ToolCall } from "../rounds/host.js";
import { librarianTools } from "../rounds/tools.js";
import { annotate, brokenEdges, correct, supersede } from "./index.js";

/** A capability, with an accepted, load-bearing decision on its shelf. */
async function shelf(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const capability = await library.addCapability({ title: "Email form", story: story.id });
  const cover = await library.recordDecision({ title: "Send through Mailgun", text: "Mailgun: the simplest API.", status: "accepted", frontCoverOf: capability.id, loadBearing: true });
  return { capability, cover };
}

/** Every text a record has held, oldest first, from the change feed. */
async function textsOf(library: Library, id: string): Promise<unknown[]> {
  return (await library.changesSince(0)).changes.filter((change) => change.recordId === id).map((change) => change.record.fields.text);
}

test("2.1 supersede records an accepted successor that takes the old one's shelf and load-bearing mark, and the old one stays readable as superseded", async () => {
  await withLibrary(async (library) => {
    const { capability, cover } = await shelf(library);
    const other = await library.recordDecision({ title: "Log every email", text: "Every email sent is logged.", status: "accepted" });

    const successor = await supersede(library, [cover.id, other.id], { title: "Send through Postmark", text: "Postmark, with its logs, replaces Mailgun." });

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

test("2.1 supersede accepts an existing successor through the tool, preserving its history and links without making a duplicate", async () => {
  await withLibrary(async (library) => {
    const { capability, cover } = await shelf(library);
    const earlier = await library.recordDecision({ title: "Send nothing", text: "No email yet.", status: "accepted" });
    const successor = await library.recordDecision({
      title: "Send through Postmark", text: "Postmark replaces Mailgun.", status: "accepted", supersedes: [earlier.id], links: [earlier.id],
      authority: { basis: "owner-directed", ownerSaid: "Use Postmark", scribedBy: "owner", at: "2026-10-06T00:00:00.000Z" },
    });
    const before = (await library.changesSince(0)).cursor;
    const call: ToolCall = { library, project: library.name, folder: ".", caller: { session: "curator" }, writer: { actor: "curator" }, log: { lines: async () => [] } };
    let invoke: (() => Promise<ToolAnswer>) | undefined;
    librarianTools().registerTools!((name, _description, input, act) => {
      if (name === "supersede") invoke = () => act(input.parse({ olds: [cover.id, earlier.id, cover.id], successor: successor.id }), call);
    });
    assert.ok(invoke);

    const answer = await invoke();

    assert.equal(answer.data?.id, successor.id);
    assert.deepEqual((await library.get(successor.id))?.fields, {
      ...successor.fields, supersedes: [earlier.id, cover.id], frontCoverOf: capability.id, loadBearing: true,
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

test("2.1 an existing successor keeps its own shelf and load-bearing mark when another decision is added", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const { capability, cover: successor } = await shelf(library);
    await supersede(library, [cover.id], successor.id);
    await supersede(library, [cover.id], successor.id);
    assert.deepEqual((await library.get(successor.id))?.fields, { ...successor.fields, supersedes: [cover.id] });
    assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [successor.id]);
  });
});

test("2.1 existing supersession refuses invalid decisions and loops before any write", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const proposal = await library.recordDecision({ title: "Proposal", text: "Maybe.", status: "proposed" });
    const retired = await library.recordDecision({ title: "Retired", text: "Gone.", status: "accepted" });
    await library.retire(retired.id, "Wrongly recorded");
    const definition = await library.defineTerm({ term: "Email", meaning: "A message." });
    await library.recordDecision({ title: "Successor", text: "Replaces Mailgun.", status: "accepted", supersedes: [cover.id] });
    const current = await library.recordDecision({ title: "Current", text: "Independent decision.", status: "accepted" });
    await library.editNote(proposal.id, { supersedes: [current.id] });
    const { cursor } = await library.changesSince(0);
    for (const id of ["decision_missing", retired.id, definition.id, proposal.id, cover.id]) {
      await assert.rejects(supersede(library, [current.id], id), /live.*decision|accepted/);
    }
    for (const id of ["decision_missing", retired.id, definition.id]) {
      await assert.rejects(supersede(library, [id], current.id), /supersedes.*decision/);
    }
    await assert.rejects(supersede(library, [current.id], current.id), /supersession loop/);
    await assert.rejects(supersede(library, [proposal.id], current.id), /supersession loop/);
    assert.equal((await library.decision(cover.id))?.record.fields.loadBearing, true);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("2.2 correct changes a decision in place, keeping the old wording in history, and refuses turning an accepted decision back to proposed", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);

    await correct(library, cover.id, { text: "Mailgun: the simplest API, sending from a verified domain.", loadBearing: false });
    const corrected = await library.decision(cover.id);
    assert.equal(corrected?.record.fields.text, "Mailgun: the simplest API, sending from a verified domain.");
    assert.equal(corrected?.record.fields.loadBearing, false);
    assert.deepEqual(await textsOf(library, cover.id), ["Mailgun: the simplest API.", "Mailgun: the simplest API, sending from a verified domain."]);

    const { cursor } = await library.changesSince(0);
    await assert.rejects(correct(library, cover.id, { status: "proposed" }), /only the owner/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("2.3 annotate adds a dated note to the target naming the decision that narrows it, and refuses a narrowing record that is not a live decision", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const narrowing = await library.recordDecision({ title: "Transactional email only", text: "Mailgun sends receipts, never newsletters.", status: "accepted" });
    const definition = await library.defineTerm({ term: "Newsletters", meaning: "Newsletters go elsewhere." });

    await annotate(library, cover.id, { by: narrowing.id, note: "Mailgun now sends transactional email only.", date: "2026-09-27" });
    const text = (await library.decision(cover.id))?.record.fields.text ?? "";
    assert.ok(text.startsWith("Mailgun: the simplest API."));
    assert.match(text, /Annotated 2026-09-27 by .*Transactional email only.*Mailgun now sends transactional email only\./s);

    const { cursor } = await library.changesSince(0);
    await assert.rejects(annotate(library, cover.id, { by: definition.id, note: "Not a decision." }), /not a live decision/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("2.4 the health report names each link or supersession pointing at a record no longer live, with both ends", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const definition = await library.defineTerm({ term: "Verified domain", meaning: "Mailgun needs a verified domain.", links: [cover.id] });
    const old = await library.recordDecision({ title: "Send nothing", text: "No email yet.", status: "accepted" });
    const successor = await library.recordDecision({ title: "Send email", text: "Email is sent.", status: "accepted", supersedes: [old.id] });
    assert.deepEqual(await brokenEdges(library), []);

    await library.retire(cover.id, "wrongly recorded");
    await library.retire(old.id, "finished business");
    assert.deepEqual(await brokenEdges(library), [
      { from: definition.id, field: "links", to: cover.id },
      { from: successor.id, field: "supersedes", to: old.id },
    ]);
  });
});
