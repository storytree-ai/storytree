// Capability 13 · Decision log
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

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
    const scoping = await decide("Retries are twice", "D1. Twice.", { supersedesClauses: [{ decision: scoped.id, clauses: ["D2"] }] });
    await note(scoped.id, `*Narrowed 2026-11-20 by ${adrOf(scoping)}:* D2 reads twice.`);

    const whole = await decide("Mail by hand", "D1. By hand.");
    const replacing = await decide("Mail by machine", "D1. By machine.", { supersedes: [whole.id] });
    await note(whole.id, `superseded on 2026-11-20 by ${replacing.id}`);

    const legacyTarget = await decide("Mail is signed", "D1. Sign it.");
    const legacy = await records.create("decision", { status: "accepted", title: "Signing is optional", text: "D1. Optional.", narrows: [legacyTarget.id] });
    await note(legacyTarget.id, `*Annotated 2026-11-20 by ${legacy.id}:* signing is optional.`);

    const unnoted = await decide("Mail has a footer", "D1. A footer.");
    const unnoting = await decide("Footers are short", "D1. Short.", { supersedesClauses: [{ decision: unnoted.id }] });

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
    await library.editNote(edgeless.id, { supersedesClauses: [{ decision: amended.id, clauses: ["D1"] }] });
    assert.deepEqual(await library.supersessionPairs(), { flagged: [], backlog: 2 });
    await verbOf("pairs").act({} as never, context, WORDS);
  } finally {
    t.mock.timers.reset();
  }
});
