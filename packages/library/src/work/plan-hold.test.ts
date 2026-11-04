/**
 * Capability 10 · Work in flight: the one rule both front doors call for a plan edit (ADR-0966 D1), run on the
 * server `pnpm test` provides, its project dropped afterwards.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { editPlanRecord } from "./plan-hold.js";

test("10.29 · a plan edit made from a session holding an increment waits on it as a pending change until its branch merges, the live record unchanged; one made from a session holding none, or to a record the increment planned, is applied live", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Rename it", body: "Red then green" });
  await library.advanceIncrement(increment.id, "active");
  const claims = [{ session: "lane", increment: increment.id, since: "2026-10-15T00:00:00.000Z" }];
  const description = async (): Promise<string | undefined> => ((await library.get(form.id))?.fields as { description?: string } | undefined)?.description;

  const held = await editPlanRecord(library, claims, "lane", { type: "capability", id: form.id, fields: { description: "Where they type it" } }, { actor: "session:lane" });
  assert.deepEqual(held, { held: increment.id }, "the branch's session's edit is held on its increment");
  assert.equal(await description(), undefined, "the live record is left alone");
  const pending = ((await library.get(increment.id))?.fields as { pending?: { record: string }[] } | undefined)?.pending ?? [];
  assert.deepEqual(pending.map((change) => change.record), [form.id], "the increment carries the change");

  const live = await editPlanRecord(library, claims, "person:owner", { type: "capability", id: form.id, fields: { description: "Typed here" } }, { actor: "person:owner" });
  assert.equal(live && "edited" in live ? live.edited.id : undefined, form.id, "an edit from main, by a session holding no increment, is applied");
  assert.equal(await description(), "Typed here");

  const own = await library.addCapability({ story: story.id, title: "Confirmation link" });
  const planned = await editPlanRecord(library, claims, "lane", { type: "capability", id: own.id, fields: { description: "Sent by mail" } }, { actor: "session:lane" });
  assert.equal(planned && "edited" in planned ? (planned.edited.fields as { description?: string }).description : undefined, "Sent by mail", "one the increment planned is edited live");
});
