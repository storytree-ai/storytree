/**
 * Capability 22 · Decision log: one test per contract 22.1-22.6 in The library story, each in a
 * fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Library } from "../../index.js";
import { ADR_FAMILY } from "../../commands/adr.js";
import { LIBRARY_FAMILIES, type LibraryVerbContext } from "../../commands/index.js";
import type { DoorWords, VerbContext } from "../../verbs/verb.js";

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

test("22.1 supersede records an accepted successor that takes the old one's shelf and load-bearing mark, and the old one stays readable as superseded", async () => {
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

test("22.1 supersede accepts an existing successor through the tool, preserving its history and links without making a duplicate", async () => {
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

test("22.1 an existing successor keeps its own shelf and load-bearing mark when another decision is added", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const { capability, cover: successor } = await shelf(library);
    await supersede(library, [cover.id], successor.id);
    await supersede(library, [cover.id], successor.id);
    assert.deepEqual((await library.get(successor.id))?.fields, { ...successor.fields, supersedes: [cover.id] });
    assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [successor.id]);
  });
});

test("22.1 existing supersession refuses invalid decisions and loops before any write", async () => {
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

test("22.3 annotate adds a dated note to the target naming the decision that narrows it, and refuses a narrowing record that is not a live decision", async () => {
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

test("22.4 the health report names each link or supersession pointing at a record no longer live, with both ends", async () => {
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

test("22.4 the health report names a check's enforces edge pointing at a principle no longer live", async () => {
  await withLibrary(async (library) => {
    const principle = await library.writeKnowledge("principle", {
      title: "Send from a verified domain",
      description: "Mail from an unverified domain bounces.",
      statement: "Every email is sent from a verified domain.",
      why: "Providers refuse the rest.",
      howToApply: "Verify the domain before the first send.",
    });
    const check = await library.writeKnowledge("check", {
      title: "Unverified sender",
      description: "A send from a domain nobody verified",
      question: "Does any send use a domain that is not verified?",
      howToAnswer: "Yes when a sender's domain has no verification record",
      enforces: [principle.id],
      graduated: [],
    });

    await library.retire(principle.id, "wrongly recorded");
    assert.deepEqual(await brokenEdges(library), [{ from: check.id, field: "enforces", to: principle.id }]);
  });
});

test("22.5 a decision superseded by `adr new --supersedes` leaves `adr list --load-bearing`, and its successor takes the mark and the shelf as supersede leaves them", async () => {
  await withLibrary(async (library) => {
    const { capability, cover } = await shelf(library);
    const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
    const context = { library, project: library.name, session: "s", folder: ".", writer: { actor: "session:s" } } as VerbContext;
    const adr = (name: string) => ADR_FAMILY.verbs.find((one) => "name" in one.command && one.command.name === name)!;

    await adr("new").act({ title: "Send through Postmark", text: "Postmark replaces Mailgun.", status: "accepted", supersedes: cover.id, decided: "2026-11-04" }, context, words);

    const [successor] = (await library.decisions()).filter((view) => view.record.fields.title === "Send through Postmark");
    const listed = (await adr("list").act({ "load-bearing": true }, context, words)).text;
    assert.doesNotMatch(listed, new RegExp(cover.id), "the superseded decision is off the load-bearing list");
    assert.match(listed, new RegExp(successor!.record.id), "and its successor is on it");
    assert.equal(successor?.record.fields.loadBearing, true);
    assert.equal(successor?.record.fields.decided, "2026-11-04", "the successor keeps the fields adr new gave it");
    assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [successor!.record.id]);
    assert.equal((await library.decision(cover.id))?.status, "superseded");

    const plain = await library.recordDecision({ title: "Log every email", text: "Every email sent is logged.", status: "accepted" });
    await adr("new").act({ title: "Log email for a month", text: "Kept a month.", status: "accepted", supersedes: plain.id }, context, words);
    await adr("new").act({ title: "Log and keep every email", text: "Kept a year.", status: "accepted", supersedes: plain.id, "load-bearing": true }, context, words);
    const marks = Object.fromEntries((await library.decisions()).map((view) => [view.record.fields.title, view.record.fields.loadBearing === true]));
    assert.equal(marks["Log email for a month"], false, "a successor of decisions without the mark gets none");
    assert.equal(marks["Log and keep every email"], true, "and one marked load-bearing keeps it");
  });
});

test("22.5 a decision superseded through `library new`, `library edit` or `adr push` leaves `adr list --load-bearing`, its successor carrying the mark and the shelf", async () => {
  await withLibrary(async (library) => {
    const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
    const context = { library, project: library.name, session: "s", folder: process.cwd(), writer: { actor: "session:s" } } as LibraryVerbContext;
    const verbOf = (family: string, name: string) => LIBRARY_FAMILIES.find((one) => one.name === family)!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
    const superseded = async (doorWrites: (old: string) => Promise<string>) => {
      const { capability, cover } = await shelf(library);
      const successor = await doorWrites(cover.id);
      const listed = (await verbOf("adr", "list").act({ "load-bearing": true }, context, words)).text;
      assert.doesNotMatch(listed, new RegExp(cover.id), "the superseded decision is off the load-bearing list");
      assert.match(listed, new RegExp(successor), "and its successor is on it");
      assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [successor], "the successor takes the shelf");
    };

    await superseded(async (old) => {
      await verbOf("library", "new").act({ "<kind>": "decision", "<fields>": { title: "Send through Postmark", text: "Postmark replaces Mailgun.", status: "accepted", supersedes: old } }, context, words);
      return (await library.decisions()).find((view) => view.record.fields.title === "Send through Postmark")!.record.id;
    });
    await superseded(async (old) => {
      const successor = await library.recordDecision({ title: "Send through Resend", text: "Resend replaces Mailgun.", status: "accepted" });
      await verbOf("library", "edit").act({ "<id>": successor.id, "<fields>": { supersedes: old } }, context, words);
      return successor.id;
    });
    await superseded(async (old) => {
      const successor = await library.recordDecision({ title: "Send through SES", text: "SES replaces Mailgun.", status: "accepted" });
      const file = path.join(mkdtempSync(path.join(tmpdir(), "adr-push-")), "successor.md");
      await verbOf("adr", "pull").act({ decision: successor.id, out: file }, context, words);
      writeFileSync(file, readFileSync(file, "utf8").replace('status: "accepted"', `status: "accepted"\nsupersedes: ${JSON.stringify([old])}`));
      await verbOf("adr", "push").act({ decision: successor.id, file }, context, words);
      return successor.id;
    });
  });
});

test("22.5 a supersede that fails part-way leaves neither the successor nor the old decision changed", async () => {
  await withLibrary(async (library) => {
    const { capability, cover } = await shelf(library);
    const { cursor } = await library.changesSince(0);
    let asked = 0;
    const failing = { actor: "curator", outsideRead: async () => {
      asked += 1;
      if (asked > 1) throw new Error("the connection dropped");
      return [];
    } };

    await assert.rejects(supersede(library, [cover.id], { title: "Send through Postmark", text: "Postmark replaces Mailgun." }, failing), /connection dropped/);

    assert.equal(asked, 2, "it failed after the successor's write, before the old decision's");
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");
    assert.equal((await library.decision(cover.id))?.record.fields.loadBearing, true);
    assert.deepEqual((await library.frontCovers(capability.id)).map(({ id }) => id), [cover.id]);
  });
});

test("22.6 a new decision written proposed, through `adr new` or `library new decision`, is refused pointing to an open question, and nothing is written", async () => {
  await withLibrary(async (library) => {
    const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
    const context = { library, project: library.name, session: "s", folder: process.cwd(), writer: { actor: "session:s" } } as LibraryVerbContext;
    const verbOf = (family: string, name: string) => LIBRARY_FAMILIES.find((one) => one.name === family)!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
    const { cursor } = await library.changesSince(0);

    await assert.rejects(verbOf("adr", "new").act({ title: "Ship on Tuesdays", text: "Quietest day.", status: "proposed" }, context, words), /ADR-1232[\s\S]*question new/);
    await assert.rejects(verbOf("library", "new").act({ "<kind>": "decision", "<fields>": { title: "Ship on Tuesdays", text: "Quietest day.", status: "proposed" } }, context, words), /ADR-1232[\s\S]*question new/);

    assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");
  });
});
