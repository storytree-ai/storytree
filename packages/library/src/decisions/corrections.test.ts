// Capability 22 · Decision corrections
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "../index.js";

import { withLibrary } from "../testing/pg.js";
import { annotate, correct } from "./index.js";

async function shelf(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const capability = await library.addCapability({ title: "Email form", story: story.id });
  const cover = await library.recordDecision({ title: "Send through Mailgun", text: "Mailgun: the simplest API.", status: "accepted", frontCoverOf: capability.id, loadBearing: true });
  return { capability, cover };
}

async function textsOf(library: Library, id: string): Promise<unknown[]> {
  return (await library.changesSince(0)).changes.filter((change) => change.recordId === id).map((change) => change.record.fields.text);
}

test("22.2 correct changes a decision in place, keeping the old wording in history, and refuses turning an accepted decision back to proposed", async () => {
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

test("22.3 · annotate adds a dated note to the target naming the decision that supersedes clauses of it, names the target once in that decision's supersedesClauses with the clauses given added (partial when none are given), and refuses a superseding record that is not a live decision", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const narrowing = await library.recordDecision({ title: "Transactional email only", text: "Mailgun sends receipts, never newsletters.", status: "accepted" });
    const definition = await library.defineTerm({ term: "Newsletters", meaning: "Newsletters go elsewhere." });
    const stored = async (): Promise<Record<string, unknown>> => (await library.decision(narrowing.id))!.record.fields as Record<string, unknown>;

    await annotate(library, cover.id, { by: narrowing.id, note: "Mailgun now sends transactional email only.", date: "2026-09-27" });
    const text = (await library.decision(cover.id))?.record.fields.text ?? "";
    assert.ok(text.startsWith("Mailgun: the simplest API."));
    assert.match(text, /Annotated 2026-09-27 by .*Transactional email only.*Mailgun now sends transactional email only\./s);
    assert.deepEqual((await stored()).supersedesClauses, [{ decision: cover.id }], "partial when no clause is given");
    assert.equal((await stored()).narrows, undefined, "never written as narrows");
    await annotate(library, cover.id, { by: narrowing.id, note: "And receipts only.", date: "2026-09-28", clauses: ["D2"] });
    assert.deepEqual((await stored()).supersedesClauses, [{ decision: cover.id, clauses: ["D2"] }], "the clauses given are added to its entry");
    await annotate(library, cover.id, { by: narrowing.id, note: "And no attachments.", date: "2026-09-29", clauses: ["D2", "D3"] });
    assert.deepEqual((await stored()).supersedesClauses, [{ decision: cover.id, clauses: ["D2", "D3"] }], "named once, however often it annotates, each clause once");

    const { cursor } = await library.changesSince(0);
    await assert.rejects(annotate(library, cover.id, { by: definition.id, note: "Not a decision." }), /not a live decision/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});
