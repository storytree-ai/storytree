import assert from "node:assert/strict";
import { test } from "node:test";

import { withLibrary } from "../../testing/pg.js";
import { annotate, correct, recordDecision, supersede } from "./index.js";

test("31.1 · through the decisions entry, a decision recorded accepted is corrected, annotated by a later decision naming its clauses, then superseded: it reads superseded by its successor, names the annotating decision and its clauses, and its history keeps the corrected wording", async () => {
  await withLibrary(async (library) => {
    const original = "Mailgun sends every email.";
    const corrected = "Mailgun sends every email, from a verified domain.";
    const decision = await recordDecision(library, { title: "Send through Mailgun", text: original, status: "accepted" });

    await correct(library, decision.id, { text: corrected });
    const narrowing = await recordDecision(library, { title: "Receipts only", text: "Mailgun sends receipts, never newsletters.", status: "accepted" });
    await annotate(library, decision.id, { by: narrowing.id, note: "Mailgun now sends receipts only.", date: "2026-11-21", clauses: ["D2"], why: "Receipts only narrows what Mailgun sends." });
    const successor = await supersede(library, [decision.id], { title: "Send through SES", text: "SES sends every email.", justifications: { [decision.id]: "SES replaces Mailgun for every email." } });

    const view = await library.decision(decision.id);
    assert.equal(view?.status, "superseded");
    assert.deepEqual(view?.supersededBy, [successor.id]);
    assert.deepEqual(view?.supersededInPart, [{ decision: narrowing.id, clauses: ["D2"] }]);
    const texts = (await library.history({ id: decision.id })).map(({ record }) => record.fields.text);
    assert.deepEqual(texts.slice(0, 2), [original, corrected]);
  });
});
