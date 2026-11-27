// Capability 10 · Arcs and increments
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "../../index.js";
import { testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import * as planHold from "./plan-hold.js";
import { editPlanRecord } from "./plan-hold.js";

test("10.62 · a plan edit made from a session holding an increment on a branch waits on it as a pending change until its branch merges, the live record unchanged; one made from a session holding none, an increment claimed on no branch or the main line, or to a record the increment planned, is applied live", async (t) => {
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

test("10.64 · Given another live session claims a capability, directly or on its claimed increment's list, when another session (not a person) adds, edits or retires a contract on it, then the write is refused unwritten, naming the holder and the capability and to wait on its claim; the holder's own write is accepted", async (t) => {
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

test("10.65 · Given another live session claims a capability, directly or on its claimed increment's list, when another session (not a person) edits a contract to move it onto that capability (its capability, or an edge whose from is it), then the edit is refused unwritten, naming the holder and the capability and to wait on its claim; the holder's own move is accepted", async (t) => {
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

test("10.67 · a capability edit giving its parent beside another field, from a session holding an increment claimed on a branch, to a capability it did not plan, not given live, is refused with nothing written, saying to give the parent alone (live at once) and the other fields in an edit of their own (pending on the increment), or the whole edit live; the parent alone goes live, and so does the edit given live, from a session holding none, or to a capability the increment planned", async (t) => {
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
  const receipts = await library.addCapability({ story: story.id, title: "Receipts" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Nest receipts", body: "Red then green" });
  await library.advanceIncrement(increment.id, "active");
  const claims = [{ session: "lane", increment: increment.id, since: "2026-11-27T00:00:00.000Z", branch: "claude/address-form" }];
  const writer = { actor: "session:lane", levels: ["packages/sign-up/src/form"] };
  const read = async (id: string): Promise<{ title?: string; parent?: string } | undefined> => (await library.get(id))?.fields as { title?: string; parent?: string } | undefined;
  const pending = async (): Promise<unknown> => ((await library.get(increment.id))?.fields as { pending?: unknown[] } | undefined)?.pending ?? [];

  const before = await library.get(receipts.id);
  const refused = await editPlanRecord(library, claims, "lane", { type: "capability", id: receipts.id, fields: { title: "Kept receipts", parent: form.id }, nests: true }, writer);
  assert.ok(refused !== null && "refused" in refused, `a parent beside a title from the branch's session is refused: ${JSON.stringify(refused)}`);
  assert.ok(refused.refused.includes("parent") && refused.refused.includes("title"), `it names the parent and the field that would wait: ${refused.refused}`);
  assert.ok(refused.refused.includes(increment.id), `it names the increment the other fields would wait on: ${refused.refused}`);
  assert.match(refused.refused, /live/, `it says the parent goes live alone, or the whole edit is given live: ${refused.refused}`);
  assert.deepEqual(await library.get(receipts.id), before, "the live capability is unchanged");
  assert.deepEqual(await pending(), [], "nothing waits on the increment");

  const alone = await editPlanRecord(library, claims, "lane", { type: "capability", id: receipts.id, fields: { parent: form.id }, nests: true }, writer);
  assert.ok(alone !== null && "edited" in alone, `the parent alone is applied live: ${JSON.stringify(alone)}`);
  assert.deepEqual([(await read(receipts.id))?.title, (await read(receipts.id))?.parent], [(before?.fields as { title?: string } | undefined)?.title, form.id], "nested under form, its title untouched");
  assert.deepEqual(await pending(), [], "the parent alone waits on nothing");

  const given = await editPlanRecord(library, claims, "lane", { type: "capability", id: receipts.id, fields: { title: "Kept receipts", parent: form.id }, nests: true, live: true }, writer);
  assert.ok(given !== null && "edited" in given, `the whole edit given live is applied: ${JSON.stringify(given)}`);
  assert.equal((await read(receipts.id))?.title, "Kept receipts");

  const tax = await library.addCapability({ story: story.id, title: "Tax" });
  const free = await editPlanRecord(library, [], "other-lane", { type: "capability", id: tax.id, fields: { title: "Taxes", parent: form.id }, nests: true }, { ...writer, actor: "session:other-lane" });
  assert.ok(free !== null && "edited" in free, `from a session holding no increment it is applied live: ${JSON.stringify(free)}`);
  assert.equal((await read(tax.id))?.title, "Taxes");
  assert.equal((await read(tax.id))?.parent, form.id);

  const own = await library.addCapability({ story: story.id, title: "Confirmation link" });
  const planned = await editPlanRecord(library, claims, "lane", { type: "capability", id: own.id, fields: { title: "Confirmation mail", parent: form.id }, nests: true }, writer);
  assert.ok(planned !== null && "edited" in planned, `to a capability the increment planned it is applied live: ${JSON.stringify(planned)}`);
  assert.equal((await read(own.id))?.title, "Confirmation mail");
  assert.equal((await read(own.id))?.parent, form.id);
  assert.deepEqual(await pending(), [], "nothing waits on the increment");
});
