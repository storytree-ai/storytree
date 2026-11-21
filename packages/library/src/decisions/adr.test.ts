// Capability 13 · Decision log
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { VerbRefusal, type DoorWords, type VerbContext } from "../verbs/verb.js";

import { connect, type Library } from "../index.js";
import { connect as connectProject } from "../project/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { LIBRARY_FAMILIES } from "../commands/index.js";
import { ADR_FAMILY } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("13.10 · the library declares the `adr` family the command line lists 4th: a pulled decision pushed back unedited writes nothing and never asks for the writer, and an edited title writes that field alone", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  const folder = mkdtempSync(path.join(tmpdir(), "library-adr-"));
  t.after(async () => {
    rmSync(folder, { recursive: true, force: true });
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);

  assert.equal(LIBRARY_FAMILIES.find((family) => family.name === "adr"), ADR_FAMILY);
  const adr = ADR_FAMILY;
  assert.equal(adr.order, 4);
  const verbOf = (name: string) => adr.verbs.find((one) => "name" in one.command && one.command.name === name)!;
  const decision = await library.recordDecision({ title: "Mail by queue", text: "Send mail from a queue.", status: "proposed" });
  let asked = 0;
  const context = { library, project: "p", session: "s", folder, get writer() { asked++; return { actor: "session:s" }; } } as VerbContext;

  await verbOf("pull").act({ decision: decision.id, out: "adr.md" }, context, WORDS);
  const before = (await library.changesSince(0)).cursor;
  const unedited = await verbOf("push").act({ decision: decision.id, file: "adr.md" }, context, WORDS);
  assert.match(unedited.text, /^No change/);
  assert.deepEqual((await library.changesSince(before)).changes, []);
  assert.equal(asked, 0, "a push that writes nothing names no writer");

  writeFileSync(path.join(folder, "adr.md"), readFileSync(path.join(folder, "adr.md"), "utf8").replace("# Mail by queue", "# Mail from a queue"));
  const edited = await verbOf("push").act({ decision: decision.id, file: "adr.md" }, context, WORDS);
  assert.equal(edited.text, `Pushed ${decision.id}: title.`);
  assert.equal((await library.decision(decision.id))?.record.fields.title, "Mail from a queue");
  assert.equal(asked, 1);
});

test("13.11 · `adr new --basis brought-across` takes the 0.2 record it points at and the basis 0.2 gave, and refuses the label without them", async (t) => {
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
  const create = ADR_FAMILY.verbs.find((one) => "name" in one.command && one.command.name === "new")!;
  const context = { library, project: "p", session: "s", folder: process.cwd(), writer: { actor: "session:s" } } as VerbContext;
  const decision = { title: "Claims are forced", text: "0.2's claim, carried over.", status: "accepted", basis: "brought-across" };

  const { cursor } = await library.changesSince(0);
  await assert.rejects(create.act(decision, context, WORDS), /brought-across[\s\S]*broughtFrom/);
  await assert.rejects(create.act({ ...decision, basis: "agent-derived", "brought-from": "ADR-0138", "brought-basis": "owner-directed" }, context, WORDS), /--basis brought-across/);
  assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");

  await create.act({ ...decision, "brought-from": "ADR-0138", "brought-basis": "owner-directed" }, context, WORDS);
  const [recorded] = await library.decisions();
  assert.equal(recorded?.record.fields.authority?.basis, "brought-across");
  assert.deepEqual(recorded?.record.fields.authority?.broughtFrom, { record: "ADR-0138", basis: "owner-directed" });
  assert.equal(recorded?.record.fields.authority?.ownerSaid, undefined);
});

async function adrWorld(t: TestContext) {
  const storytree = await connect({ url: testServerUrl() });
  const lower = await connectProject({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    await lower.close();
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const { records } = await lower.openProject(project);
  const context = { library, project: "p", session: "s", folder: process.cwd(), writer: { actor: "session:s" } } as VerbContext;
  const verbOf = (name: string) => ADR_FAMILY.verbs.find((one) => "name" in one.command && one.command.name === name)!;
  return { library, records, context, verbOf };
}

const adrOf = (decision: { readonly fields: { readonly number?: number | undefined } }): string => `ADR-${String(decision.fields.number).padStart(4, "0")}`;

async function backlogCounts(library: Library): Promise<{ links: number; decisions: number }> {
  const { links, decisions } = await library.decisionLinkBacklog();
  return { links, decisions };
}

async function storedFields(library: Library, id: string): Promise<Record<string, unknown> | undefined> {
  return (await library.get(id))?.fields as Record<string, unknown> | undefined;
}

test("13.16 · moveNarrowsToClauses and `adr move-narrows` move each stored narrows onto a supersedesClauses entry, its clauses those the narrowing text names beside the narrowed decision's ADR number, partial where it names none, leaving no narrows; a second run writes nothing", async (t) => {
  const { library, records, context, verbOf } = await adrWorld(t);
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "D1. Queue. D2. Retry. D3. Bounce." });
  const log = await library.recordDecision({ status: "accepted", title: "Mail is logged", text: "D1. Log. D4. Keep a year." });
  const sender = await library.recordDecision({ status: "accepted", title: "One sender", text: "D1. One sender address." });
  const narrowing = await records.create("decision", {
    status: "accepted", title: "Receipts through SES",
    text: `D1. This narrows ${adrOf(queue)} D2 and D3, and ${adrOf(log)}'s D4; it touches ${adrOf(sender)} too.`,
    narrows: [queue.id, log.id, sender.id],
  });

  assert.deepEqual(await library.moveNarrowsToClauses(), { decisions: [narrowing.id], edges: 3, partial: 1 });
  const moved = await storedFields(library, narrowing.id);
  assert.deepEqual(moved?.supersedesClauses, [{ decision: queue.id, clauses: ["D2", "D3"] }, { decision: log.id, clauses: ["D4"] }, { decision: sender.id }]);
  assert.equal(moved?.narrows, undefined, "no narrows is left stored");

  const { cursor } = await library.changesSince(0);
  assert.deepEqual(await library.moveNarrowsToClauses(), { decisions: [], edges: 0, partial: 0 });
  assert.deepEqual((await library.changesSince(cursor)).changes, [], "a second run writes nothing");

  const later = await records.create("decision", { status: "accepted", title: "Bounces are retried", text: `Narrows ${adrOf(queue)} D3.`, narrows: [queue.id] });
  await verbOf("move-narrows").act({} as never, context, WORDS);
  const command = await storedFields(library, later.id);
  assert.deepEqual(command?.supersedesClauses, [{ decision: queue.id, clauses: ["D3"] }], "the command moves it too");
  assert.equal(command?.narrows, undefined);
});

test("13.17 · supersessionPairs and `adr pairs` flag a clause-scoped supersedes with no in-place note naming it and an in-place note with no edge behind it, failing while any is flagged; a pair whose superseding decision was recorded before 2026-11-20 is counted as backlog", async (t) => {
  const { library, records, context, verbOf } = await adrWorld(t);
  const decide = (title: string, text: string, more: object = {}) => library.recordDecision({ status: "accepted", title, text, ...more });
  const note = async (id: string, line: string): Promise<void> => {
    const text = (await library.decision(id))!.record.fields.text;
    await library.editNote(id, { text: `${text}\n\n${line}` });
  };
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-19T12:00:00.000Z") });
  try {
    const oldTarget = await decide("Mail by queue", "D1. Queue.");
    await records.create("decision", { status: "accepted", title: "Receipts first", text: "D1. Receipts jump the queue.", narrows: [oldTarget.id] });
    const oldNoter = await decide("Logs are kept", "D1. Keep logs.");
    await decide("Logs rotate", `D1. Rotate them. *Replaced by ${adrOf(oldNoter)}.*`);
    t.mock.timers.tick(86_400_000);

    const scoped = await decide("Mail retries", "D1. Retry. D2. Thrice.");
    const scoping = await decide("Retries are twice", "D1. Twice.", { supersedesClauses: [{ decision: scoped.id, clauses: ["D2"] }], justifications: { [scoped.id]: "Twice replaces its D2." } });
    await note(scoped.id, `*Narrowed 2026-11-20 by ${adrOf(scoping)}:* D2 reads twice.`);

    const whole = await decide("Mail by hand", "D1. By hand.");
    const replacing = await decide("Mail by machine", "D1. By machine.", { supersedes: [whole.id], justifications: { [whole.id]: "Machines replace hands." } });
    await note(whole.id, `superseded on 2026-11-20 by ${replacing.id}`);

    const legacyTarget = await decide("Mail is signed", "D1. Sign it.");
    const legacy = await records.create("decision", { status: "accepted", title: "Signing is optional", text: "D1. Optional.", narrows: [legacyTarget.id] });
    await note(legacyTarget.id, `*Annotated 2026-11-20 by ${legacy.id}:* signing is optional.`);

    const unnoted = await decide("Mail has a footer", "D1. A footer.");
    const unnoting = await decide("Footers are short", "D1. Short.", { supersedesClauses: [{ decision: unnoted.id }], justifications: { [unnoted.id]: "Short footers replace part of it." } });

    const edgeless = await decide("Bounces are logged", "D1. Log bounces.");
    const amended = await decide("Bounces are dropped", `D1. Drop them. *Amended by ${adrOf(edgeless)}.*`);

    const read = await library.supersessionPairs();
    assert.deepEqual([...read.flagged].sort((a, b) => a.kind.localeCompare(b.kind)), [
      { kind: "no-edge", from: edgeless.id, to: amended.id },
      { kind: "no-note", from: unnoting.id, to: unnoted.id },
    ]);
    assert.equal(read.backlog, 2, "the two pairs whose superseding decision came before 2026-11-20");
    await assert.rejects(verbOf("pairs").act({} as never, context, WORDS), VerbRefusal, "the command fails while a pair is flagged");

    await note(unnoted.id, `*Narrowed by ${adrOf(unnoting)}*`);
    await library.editNote(edgeless.id, { supersedesClauses: [{ decision: amended.id, clauses: ["D1"] }], justifications: { [amended.id]: "Logging replaces its D1." } });
    assert.deepEqual(await library.supersessionPairs(), { flagged: [], backlog: 2 });
    await verbOf("pairs").act({} as never, context, WORDS);
  } finally {
    t.mock.timers.reset();
  }
});

test("13.20 · `adr new --why <target>=<text>` writes each decision link's and supersession's justification, split on the first =; `adr new` linking or superseding a decision with no --why for it is refused naming justification and the target, with nothing written", async (t) => {
  const { library, context, verbOf } = await adrWorld(t);
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "Queue it." });
  const hand = await library.recordDecision({ status: "accepted", title: "Mail by hand", text: "By hand." });
  const decision = { title: "Retries are twice", text: "Retry twice.", status: "accepted", basis: "agent-derived" };

  const { cursor } = await library.changesSince(0);
  await assert.rejects(verbOf("new").act({ ...decision, links: queue.id }, context, WORDS), (error: Error) => error.message.includes("justification") && error.message.includes(queue.id), "a link with no --why");
  await assert.rejects(verbOf("new").act({ ...decision, supersedes: hand.id, why: [`${queue.id}=Not the superseded one.`] }, context, WORDS), (error: Error) => error.message.includes("justification") && error.message.includes(hand.id), "a supersession with no --why for it");
  assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");

  await verbOf("new").act({ ...decision, links: queue.id, supersedes: hand.id, why: [`${queue.id}=Follow it for where a retry waits; a=b stays whole.`, `${hand.id}=Retries replace sending by hand.`] }, context, WORDS);
  const recorded = (await library.decisions()).find((view) => view.record.fields.title === "Retries are twice");
  assert.deepEqual((recorded?.record.fields as { justifications?: unknown } | undefined)?.justifications, {
    [queue.id]: "Follow it for where a retry waits; a=b stays whole.",
    [hand.id]: "Retries replace sending by hand.",
  });
});

test("13.21 · `adr pull` shows a decision's justifications as an editable front-matter line keyed by target, and `adr push` writes an edited one back", async (t) => {
  const { library, context, verbOf } = await adrWorld(t);
  const folder = mkdtempSync(path.join(tmpdir(), "library-adr-why-"));
  t.after(() => removeTemp(folder));
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "Queue it." });
  const linking = await library.recordDecision({ status: "accepted", title: "Retries are twice", text: "Retry twice.", links: [queue.id], justifications: { [queue.id]: "Follow it for where a retry waits." } } as never);
  const here = { ...context, folder };

  await verbOf("pull").act({ decision: linking.id, out: "why.md" }, here, WORDS);
  const file = readFileSync(path.join(folder, "why.md"), "utf8");
  const editable = file.slice(0, file.indexOf("# read only"));
  assert.ok(editable.split("\n").includes(`justifications: ${JSON.stringify({ [queue.id]: "Follow it for where a retry waits." })}`), `the justification sits beside its target in the editable front matter:\n${file}`);

  writeFileSync(path.join(folder, "why.md"), file.replace("Follow it for where a retry waits.", "Follow it for the queue a retry waits in."));
  const pushed = await verbOf("push").act({ decision: linking.id, file: "why.md" }, here, WORDS);
  assert.equal(pushed.text, `Pushed ${linking.id}: justifications.`);
  assert.deepEqual(((await library.decision(linking.id))?.record.fields as { justifications?: unknown }).justifications, { [queue.id]: "Follow it for the queue a retry waits in." });
});

test("13.22 · decisionLinkBacklog and `adr backlog` count the old-shape decision links, stored with no justification, and the decisions holding them, never failing on them; a justified link or a link to a story is not counted, and an old-shape decision's text still edits", async (t) => {
  const { library, records, context, verbOf } = await adrWorld(t);
  const story = await library.addStory({ title: "Mail" });
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "Queue it." });
  const log = await library.recordDecision({ status: "accepted", title: "Mail is logged", text: "Log it." });
  const hand = await library.recordDecision({ status: "accepted", title: "Mail by hand", text: "By hand." });
  assert.deepEqual(await backlogCounts(library), { links: 0, decisions: 0 }, "none before any old-shape link");

  const old = await records.create("decision", { status: "accepted", title: "Retries", text: "Retry thrice.", links: [queue.id, log.id, story.id] });
  await records.create("decision", { status: "accepted", title: "Bounces", text: "Drop them.", supersedesClauses: [{ decision: hand.id, clauses: ["D1"] }] });
  await library.recordDecision({ status: "accepted", title: "Receipts", text: "Send them.", links: [queue.id], justifications: { [queue.id]: "Follow it for where receipts wait." } } as never);

  assert.deepEqual(await backlogCounts(library), { links: 3, decisions: 2 });
  const answer = await verbOf("backlog").act({} as never, context, WORDS);
  assert.equal(answer.text, "3 old-shape decision links (no justification) across 2 decisions");

  await library.editNote(old.id, { text: "Retry twice." });
  assert.equal((await library.decision(old.id))?.record.fields.text, "Retry twice.", "the old shape is tolerated by a later edit");
  assert.deepEqual(await backlogCounts(library), { links: 3, decisions: 2 }, "and still counted");
});

test("13.25 · decisionLinkBacklog's targets and `adr backlog --by-target` list each decision old-shape links point at with its number, title and count, most links in first and ties by number, counting no justified link and no link to a story; the plain `adr backlog` keeps its two counts", async (t) => {
  const { library, records, context, verbOf } = await adrWorld(t);
  const story = await library.addStory({ title: "Mail" });
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "Queue it." });
  const log = await library.recordDecision({ status: "accepted", title: "Mail is logged", text: "Log it." });
  const hand = await library.recordDecision({ status: "accepted", title: "Mail by hand", text: "By hand." });
  assert.deepEqual((await library.decisionLinkBacklog()).targets, [], "no targets before any old-shape link");

  await records.create("decision", { status: "accepted", title: "Retries", text: "Retry thrice.", links: [queue.id, log.id, story.id] });
  await records.create("decision", { status: "accepted", title: "Resends", text: "Resend once.", links: [log.id, hand.id] });
  await library.recordDecision({ status: "accepted", title: "Receipts", text: "Send them.", links: [hand.id], justifications: { [hand.id]: "Follow it for who sends receipts." } } as never);

  assert.deepEqual(await library.decisionLinkBacklog(), {
    links: 4,
    decisions: 2,
    targets: [
      { number: log.fields.number, title: "Mail is logged", links: 2 },
      { number: queue.fields.number, title: "Mail by queue", links: 1 },
      { number: hand.fields.number, title: "Mail by hand", links: 1 },
    ],
  });
  assert.equal((await verbOf("backlog").act({ "by-target": false } as never, context, WORDS)).text, "4 old-shape decision links (no justification) across 2 decisions");
  assert.equal(
    (await verbOf("backlog").act({ "by-target": true } as never, context, WORDS)).text,
    [`${adrOf(log)}  Mail is logged  2 old-shape links in`, `${adrOf(queue)}  Mail by queue  1 old-shape link in`, `${adrOf(hand)}  Mail by hand  1 old-shape link in`].join("\n"),
  );
});

test("13.23 · `adr prune` archives a decision link with who, when and why and its justification, so links, `library links` and the backlog no longer show it, `adr pruned` lists it, and `adr restore` puts it back with its justification, or --why for one that had none; a prune with no reason or no such link is refused", async (t) => {
  const { library, records, context, verbOf } = await adrWorld(t);
  const links = LIBRARY_FAMILIES.find((family) => family.name === "library")!.verbs.find((one) => "name" in one.command && one.command.name === "links")!;
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "Queue it." });
  const linking = await library.recordDecision({ status: "accepted", title: "Retries are twice", text: "Retry twice.", links: [queue.id], justifications: { [queue.id]: "Follow it for where a retry waits." } } as never);
  const old = await records.create("decision", { status: "accepted", title: "Bounces", text: "Drop them.", links: [queue.id] });
  assert.deepEqual(await backlogCounts(library), { links: 1, decisions: 1 });

  const { cursor } = await library.changesSince(0);
  await assert.rejects(verbOf("prune").act({ decision: linking.id, target: queue.id, reason: undefined } as never, context, WORDS), VerbRefusal, "no reason");
  await assert.rejects(verbOf("prune").act({ decision: linking.id, target: old.id, reason: "Not linked." } as never, context, WORDS), VerbRefusal, "no such link");
  assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");

  const before = Date.now();
  await verbOf("prune").act({ decision: linking.id, target: queue.id, reason: "The queue rule moved." } as never, context, WORDS);
  await verbOf("prune").act({ decision: old.id, target: queue.id, reason: "Bounces never queue." } as never, context, WORDS);
  const pruned = (await library.get(linking.id))?.fields as { links?: string[]; archivedLinks?: { to: string; field: string; justification?: string; reason: string; by: string; at: string }[] };
  assert.deepEqual(pruned.links ?? [], [], "the link is out of links");
  assert.deepEqual(pruned.archivedLinks?.map(({ at: _at, ...rest }) => rest), [{ to: queue.id, field: "links", justification: "Follow it for where a retry waits.", reason: "The queue rule moved.", by: "session:s" }]);
  const at = Date.parse(pruned.archivedLinks![0]!.at);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, `archived at the time of the prune: ${pruned.archivedLinks![0]!.at}`);
  assert.equal((await links.act({ artifact: queue.id }, context as never, WORDS)).text, `No artifact links to ${queue.id}.`, "an archived link is not followed");
  assert.deepEqual(await backlogCounts(library), { links: 0, decisions: 0 }, "nor counted as an old-shape link");

  const listed = (await verbOf("pruned").act({ decision: undefined } as never, context, WORDS)).text;
  for (const [from, reason] of [[linking.id, "The queue rule moved."], [old.id, "Bounces never queue."]] as const) {
    const line = listed.split("\n").find((one) => one.includes(from));
    assert.ok(line !== undefined && line.includes(queue.id) && line.includes("links") && line.includes("session:s") && line.includes(reason), `adr pruned lists ${from}'s archived link with field, by and reason:\n${listed}`);
  }

  await verbOf("restore").act({ decision: linking.id, target: queue.id, why: undefined } as never, context, WORDS);
  const restored = (await library.get(linking.id))?.fields as { links?: string[]; justifications?: Record<string, string>; archivedLinks?: unknown[] };
  assert.deepEqual([restored.links, restored.justifications, restored.archivedLinks ?? []], [[queue.id], { [queue.id]: "Follow it for where a retry waits." }, []], "back with its justification, out of the archive");
  await assert.rejects(verbOf("restore").act({ decision: old.id, target: queue.id, why: undefined } as never, context, WORDS), (error: Error) => error.message.includes("justification") && error.message.includes(queue.id), "an old-shape link comes back only with a justification");
  await verbOf("restore").act({ decision: old.id, target: queue.id, why: "Follow it for how bounces would queue." } as never, context, WORDS);
  const back = (await library.get(old.id))?.fields as { links?: string[]; justifications?: Record<string, string> };
  assert.deepEqual([back.links, back.justifications], [[queue.id], { [queue.id]: "Follow it for how bounces would queue." }]);
});

test("13.24 · decision(id) carries supersededInPart, each accepted decision superseding it in named clauses with those clauses and an old-shape narrows with none, its status kept as stored; `adr pull` prints them and the records linking in as read-only superseded-in-part and linked-from lines, and `adr push` of the pulled file writes nothing", async (t) => {
  const { library, records, context, verbOf } = await adrWorld(t);
  const folder = mkdtempSync(path.join(tmpdir(), "library-adr-in-part-"));
  t.after(() => removeTemp(folder));
  const here = { ...context, folder };
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "D1. Queue. D2. Retry. D3. Bounce." });
  const log = await library.recordDecision({ status: "accepted", title: "Mail is logged", text: "D1. Log." });
  const retries = await records.create("decision", { status: "accepted", title: "Retries are twice", text: "Retry twice.", supersedesClauses: [{ decision: queue.id, clauses: ["D2", "D3"] }] });
  await records.create("decision", { status: "accepted", title: "Logs kept a year", text: "A year.", supersedesClauses: [{ decision: log.id, clauses: ["D1"] }] });
  const bounces = await records.create("decision", { status: "accepted", title: "Bounces are dropped", text: "Drop them.", narrows: [queue.id] });
  await records.create("decision", { status: "proposed", title: "Bounces are kept", text: "Keep them.", supersedesClauses: [{ decision: queue.id, clauses: ["D3"] }] });
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Queue the mail", objective: "Build it", body: "Red then green", links: [queue.id] });
  const friction = await library.writeKnowledge("friction", {
    title: "Mail sent inline", description: "A send blocked sign-up.", statement: "Sign-up waited on the mail server.", evidence: "Sign-up took 9 s.", impact: "Visitors left.",
  });
  await library.editNote(friction.id, { route: "adr", routeReason: "Decided to queue.", dischargedBy: queue.id });

  const view = await library.decision(queue.id);
  const inPart = [{ decision: retries.id, clauses: ["D2", "D3"] }, { decision: bounces.id }];
  assert.deepEqual((view as { supersededInPart?: unknown } | null)?.supersededInPart, inPart, "the accepted clause supersession with its clauses, then the old-shape narrows with none, in the order they were recorded; not the proposed one nor the one on another decision");
  assert.deepEqual([view?.status, view?.supersededBy], ["accepted", []], "superseded only in part, it reads as stored");
  assert.deepEqual((await library.decision(retries.id) as { supersededInPart?: unknown } | null)?.supersededInPart, [], "none supersedes the later one in part");

  await verbOf("pull").act({ decision: queue.id, out: "queue.md" }, here, WORDS);
  const file = readFileSync(path.join(folder, "queue.md"), "utf8");
  const readOnly = file.slice(file.indexOf("# read only"), file.indexOf("\n---\n", 4)).split("\n");
  assert.ok(readOnly.includes(`superseded-in-part: ${JSON.stringify(inPart)}`), `a read-only superseded-in-part line:\n${file}`);
  assert.ok(readOnly.includes(`linked-from: ${JSON.stringify([increment.id, friction.id].sort())}`), `a read-only linked-from line, in id order:\n${file}`);

  const { cursor } = await library.changesSince(0);
  const pushed = await verbOf("push").act({ decision: queue.id, file: "queue.md" }, here, WORDS);
  assert.match(pushed.text, /^No change/);
  assert.deepEqual((await library.changesSince(cursor)).changes, []);
});
