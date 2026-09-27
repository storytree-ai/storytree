/**
 * Capability 2 · Decision log: one test per contract 2.1-2.4 in the librarian story, each in a
 * fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
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
    const memory = await library.writeMemory({ text: "Newsletters go elsewhere." });

    await annotate(library, cover.id, { by: narrowing.id, note: "Mailgun now sends transactional email only.", date: "2026-09-27" });
    const text = (await library.decision(cover.id))?.record.fields.text ?? "";
    assert.ok(text.startsWith("Mailgun: the simplest API."));
    assert.match(text, /Annotated 2026-09-27 by .*Transactional email only.*Mailgun now sends transactional email only\./s);

    const { cursor } = await library.changesSince(0);
    await assert.rejects(annotate(library, cover.id, { by: memory.id, note: "Not a decision." }), /not a live decision/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("2.4 the health report names each link or supersession pointing at a record no longer live, with both ends", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const memory = await library.writeMemory({ text: "Mailgun needs a verified domain.", links: [cover.id] });
    const old = await library.recordDecision({ title: "Send nothing", text: "No email yet.", status: "accepted" });
    const successor = await library.recordDecision({ title: "Send email", text: "Email is sent.", status: "accepted", supersedes: [old.id] });
    assert.deepEqual(await brokenEdges(library), []);

    await library.retire(cover.id, "wrongly recorded");
    await library.retire(old.id, "finished business");
    assert.deepEqual(await brokenEdges(library), [
      { from: memory.id, field: "links", to: cover.id },
      { from: successor.id, field: "supersedes", to: old.id },
    ]);
  });
});
