import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkModel } from "../../plan/index.js";
import { connect, type Storytree } from "../../projects/open/index.js";
import { testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import { WorkInFlight } from "./index.js";
import * as planHold from "./plan-hold.js";
import { editPlanRecord } from "./plan-hold.js";

test("4.36 · a plan edit made from a session holding an increment on a branch waits on it as a pending change until its branch merges, the live record unchanged; one made from a session holding none, an increment claimed on no branch or the main line, or to a record the increment planned, is applied live", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await openLibrary(storytree, project);
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Rename it", body: "Red then green" });
  await library.advanceIncrement(increment.id, "active");
  const claims = [{ session: "lane", increment: increment.id, since: "2026-10-15T00:00:00.000Z", branch: "claude/address-form" }];
  const description = async (): Promise<string | undefined> => ((await library.get(form.id))?.fields as { description?: string } | undefined)?.description;

  const held = await editPlanRecord(library, claims, "lane", { type: "capability", id: form.id, fields: { description: "Where they type it" } }, { actor: "session:lane" });
  assert.deepEqual(held, { held: increment.id }, "the branch's session's edit is held on its increment");
  assert.equal(await description(), undefined, "the live record is left alone");
  const pending = ((await library.get(increment.id))?.fields as { pending?: { record: string }[] } | undefined)?.pending ?? [];
  assert.deepEqual(pending.map((change) => change.record), [form.id], "the increment carries the change");

  const live = await editPlanRecord(library, claims, "person:owner", { type: "capability", id: form.id, fields: { description: "Typed here" } }, { actor: "person:owner" });
  assert.equal(live && "edited" in live ? live.edited.id : undefined, form.id, "an edit from main, by a session holding no increment, is applied");
  assert.equal(await description(), "Typed here");

  for (const branch of [undefined, "main"]) {
    const branchless = [{ session: "library-lane", increment: increment.id, since: "2026-10-15T00:00:00.000Z", ...(branch === undefined ? {} : { branch }) }];
    const applied = await editPlanRecord(library, branchless, "library-lane", { type: "capability", id: form.id, fields: { description: `Typed ${branch ?? "detached"}` } }, { actor: "session:library-lane" });
    assert.equal(applied && "edited" in applied ? applied.edited.id : undefined, form.id, `an increment claimed on ${branch ?? "no branch"} has none to merge, so its session's edit is applied`);
    assert.equal(await description(), `Typed ${branch ?? "detached"}`);
  }

  const own = await library.addCapability({ story: story.id, title: "Confirmation link" });
  const planned = await editPlanRecord(library, claims, "lane", { type: "capability", id: own.id, fields: { description: "Sent by mail" } }, { actor: "session:lane" });
  assert.equal(planned && "edited" in planned ? (planned.edited.fields as { description?: string }).description : undefined, "Sent by mail", "one the increment planned is edited live");
});

test("4.55 · Given another live session claims a capability, directly or on its claimed increment's list, when another session (not a person) adds, edits or retires a contract on it, then the write is refused unwritten, naming the holder and the capability and to wait on its claim; the holder's own write is accepted", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await openLibrary(storytree, project);
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const mail = await library.addCapability({ story: story.id, title: "Welcome mail" });
  const free = await library.addCapability({ story: story.id, title: "Thanks page" });
  const link = await library.addEdge({ from: form.id, to: free.id });
  const onForm = await library.addContract({ capability: form.id, title: "3.1 · Accepts a valid address" });
  const onLink = await library.addContract({ edge: link.id, title: "3.2 · The form sends its visitor to the thanks page" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Welcome mail", objective: "Send it", body: "Red then green" });
  await library.editIncrement(increment.id, { capabilities: [mail.id] });
  await library.advanceIncrement(increment.id, "active");
  const claims = [
    { session: "form-lane", capability: form.id, since: "2026-11-24T14:00:00.000Z", holder: "live" as const },
    { session: "mail-lane", increment: increment.id, since: "2026-11-24T14:00:00.000Z", holder: "live" as const },
    { session: "idle-lane", capability: free.id, since: "2026-11-24T13:00:00.000Z", holder: "idle" as const },
  ];
  const titleOf = async (id: string): Promise<string | undefined> => ((await library.get(id))?.fields as { title?: string } | undefined)?.title;

  const edited = await editPlanRecord(library, claims, "other-lane", { type: "contract", id: onForm.id, fields: { title: "3.1 · Accepts any address" } }, { actor: "session:other-lane" });
  assert.ok(edited !== null && "refused" in edited, `another session's edit of a contract on a claimed capability is refused: ${JSON.stringify(edited)}`);
  assert.ok(edited.refused.includes("form-lane") && edited.refused.includes(form.id) && /wait on/.test(edited.refused), edited.refused);
  assert.equal(await titleOf(onForm.id), "3.1 · Accepts a valid address", "the refused edit wrote nothing");

  const refused = async (session: string, target: string): Promise<string | undefined> => planHold.refuseHeldPlanWrite(library, claims, session, target);
  for (const [target, holder, capability, what] of [
    [form.id, "form-lane", form.id, "a new contract on a capability claimed directly"],
    [onForm.id, "form-lane", form.id, "an edit or retirement of a contract on a capability claimed directly"],
    [mail.id, "mail-lane", mail.id, "a new contract on a capability on the list of an increment another live session claims"],
    [link.id, "form-lane", form.id, "a new contract on an edge whose from is a claimed capability"],
    [onLink.id, "form-lane", form.id, "an edit or retirement of a contract on an edge whose from is a claimed capability"],
  ] as const) {
    const said = await refused("other-lane", target);
    assert.ok(said !== undefined && said.includes(holder) && said.includes(capability) && /wait on/.test(said) && /claim/.test(said), `${what} is refused, naming ${holder} and ${capability} and to wait on its claim: ${said}`);
  }
  assert.equal(await refused("form-lane", form.id), undefined, "the holder's own new contract is accepted");
  assert.equal(await refused("form-lane", onForm.id), undefined, "the holder's own edit or retirement is accepted");
  assert.equal(await refused("mail-lane", mail.id), undefined, "the session claiming the increment that lists it writes on it");
  assert.equal(await refused("person:owner", onForm.id), undefined, "a person's write is accepted");
  assert.equal(await refused("other-lane", free.id), undefined, "an idle session's claim does not count");

  const own = await editPlanRecord(library, claims, "form-lane", { type: "contract", id: onForm.id, fields: { title: "3.1 · Accepts a postal address" } }, { actor: "session:form-lane" });
  assert.ok(own !== null && "edited" in own, "the holder's own edit is applied");
  assert.equal(await titleOf(onForm.id), "3.1 · Accepts a postal address");
});

test("4.56 · Given another live session claims a capability, directly or on its claimed increment's list, when another session (not a person) edits a contract to move it onto that capability (its capability, or an edge whose from is it), then the edit is refused unwritten, naming the holder and the capability and to wait on its claim; the holder's own move is accepted", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await openLibrary(storytree, project);
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const mail = await library.addCapability({ story: story.id, title: "Welcome mail" });
  const free = await library.addCapability({ story: story.id, title: "Thanks page" });
  const link = await library.addEdge({ from: form.id, to: free.id });
  const loose = await library.addContract({ capability: free.id, title: "3.1 · Thanks the visitor by name" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Welcome mail", objective: "Send it", body: "Red then green" });
  await library.editIncrement(increment.id, { capabilities: [mail.id] });
  await library.advanceIncrement(increment.id, "active");
  const claims = [
    { session: "form-lane", capability: form.id, since: "2026-11-24T14:00:00.000Z", holder: "live" as const },
    { session: "mail-lane", increment: increment.id, since: "2026-11-24T14:00:00.000Z", holder: "live" as const },
  ];
  const placeOf = async (): Promise<{ capability: string | undefined; edge: string | undefined }> => {
    const fields = (await library.get(loose.id))?.fields as { capability?: string; edge?: string } | undefined;
    return { capability: fields?.capability, edge: fields?.edge };
  };

  for (const [fields, holder, capability, what] of [
    [{ capability: form.id }, "form-lane", form.id, "a move onto a capability claimed directly"],
    [{ edge: link.id }, "form-lane", form.id, "a move onto an edge whose from is a claimed capability"],
    [{ capability: mail.id }, "mail-lane", mail.id, "a move onto a capability on the list of an increment another live session claims"],
  ] as const) {
    const moved = await editPlanRecord(library, claims, "other-lane", { type: "contract", id: loose.id, fields }, { actor: "session:other-lane" });
    assert.ok(moved !== null && "refused" in moved, `${what} is refused: ${JSON.stringify(moved)}`);
    assert.ok(moved.refused.includes(holder) && moved.refused.includes(capability) && /wait on/.test(moved.refused), `${what} names ${holder} and ${capability} and to wait on its claim: ${moved.refused}`);
    assert.deepEqual(await placeOf(), { capability: free.id, edge: undefined }, `${what} wrote nothing`);
  }

  const own = await editPlanRecord(library, claims, "form-lane", { type: "contract", id: loose.id, fields: { capability: form.id } }, { actor: "session:form-lane" });
  assert.ok(own !== null && "edited" in own, `the holder's own move is applied: ${JSON.stringify(own)}`);
  assert.deepEqual(await placeOf(), { capability: form.id, edge: undefined });
});

async function openLibrary(storytree: Storytree, name: string) {
  const { records } = await storytree.openProject(name);
  const work = new WorkModel(records);
  const flight = new WorkInFlight(records, work);
  return {
    get: records.get.bind(records),
    createArc: flight.createArc.bind(flight),
    addStory: work.addStory.bind(work),
    addCapability: work.addCapability.bind(work),
    addEdge: work.addEdge.bind(work),
    addContract: work.addContract.bind(work),
    addIncrement: flight.addIncrement.bind(flight),
    editIncrement: flight.editIncrement.bind(flight),
    advanceIncrement: flight.advanceIncrement.bind(flight),
    editStory: work.editStory.bind(work),
    editCapability: work.editCapability.bind(work),
    editContract: work.editContract.bind(work),
    editEdge: work.editEdge.bind(work),
    editArc: flight.editArc.bind(flight),
    pendChange: flight.pendChange.bind(flight),
  };
}
