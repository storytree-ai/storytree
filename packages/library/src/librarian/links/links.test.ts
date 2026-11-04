/**
 * Capability 21 · Links: one test per contract 21.1-21.5 in The library story, each in a fresh
 * project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "../../index.js";

import { withLibrary } from "../testing/pg.js";
import { worklist } from "../rounds/index.js";
import { brokenEdges, link, unrestedDecisions } from "./index.js";

/** A story with one capability, and a decision on its shelf. */
async function shelf(library: Library) {
  const story = await library.addStory({ title: "Visitor can sign up" });
  const capability = await library.addCapability({ title: "Email form", story: story.id });
  const cover = await library.recordDecision({ title: "Send through Mailgun", text: "Simplest API.", status: "accepted", frontCoverOf: capability.id });
  return { capability, cover };
}

/** A decision about the whole project: on no shelf. */
function wholeProject(library: Library, title: string) {
  return library.recordDecision({ title, text: `${title}, for every part of the project.`, status: "accepted" });
}

test("21.1 link makes a note rest on another, keeping its other links, and linking again writes nothing", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const tdd = await wholeProject(library, "Minimal viable TDD");
    const spec = await wholeProject(library, "The MVP spec");
    await library.editNote(cover.id, { links: [tdd.id] });

    await link(library, cover.id, spec.id);
    assert.deepEqual((await library.decision(cover.id))?.record.fields.links, [tdd.id, spec.id]);

    const { cursor } = await library.changesSince(0);
    await link(library, cover.id, spec.id);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("21.2 a definition rests only on a decision, and friction or a re-steer on nothing: other links are refused, naming the rule", async () => {
  await withLibrary(async (library) => {
    const decision = await wholeProject(library, "Arcs hold increments");
    const term = await library.defineTerm({ term: "increment", meaning: "One slice of work on an arc." });
    const other = await library.defineTerm({ term: "arc", meaning: "An initiative." });
    const friction = await library.writeKnowledge("friction", {
      title: "Seed refused while the app runs",
      description: "The seed cannot run with the app open.",
      statement: "pnpm seed:library refuses while the app holds its data directory.",
      evidence: "`pnpm seed:library` printed: Quit the app, then run `pnpm seed:library` again.",
      impact: "The library is not re-seeded until the owner quits the app.",
    });
    const { cursor } = await library.changesSince(0);

    await assert.rejects(link(library, term.id, other.id), /definition rests only on a decision/);
    await assert.rejects(link(library, friction.id, decision.id), /friction rests on nothing/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    await link(library, term.id, decision.id);
    assert.deepEqual((await library.search("slice of work"))[0]?.fields.links, [decision.id]);
  });
});

test("21.3 the worklist names each accepted decision on no shelf that no note rests on, and drops it once one does", async () => {
  await withLibrary(async (library) => {
    const { cover } = await shelf(library);
    const spec = await wholeProject(library, "The MVP spec");
    const license = await wholeProject(library, "The license");

    // Two decisions written back to back can share a creation millisecond, so their order is the
    // random ids'; the contract promises which decisions, not their order.
    assert.deepEqual((await unrestedDecisions(library)).map((decision) => decision.id).sort(), [spec.id, license.id].sort());

    await link(library, cover.id, spec.id);
    assert.deepEqual((await unrestedDecisions(library)).map((decision) => decision.id), [license.id]);
  });
});

test("21.4 the worklist finds related but unlinked neighbours for live notes written since the cursor, including edits", async () => {
  await withLibrary(async (library) => {
    const source = await wholeProject(library, "Verify Mailgun confirmation domains");
    const outgoing = await wholeProject(library, "Mailgun confirmation delivery");
    const incoming = await wholeProject(library, "Mailgun confirmation retries");
    const neighbour = await wholeProject(library, "Mailgun confirmation bounces");
    await link(library, source.id, outgoing.id);
    await link(library, incoming.id, source.id);
    const { cursor } = await library.changesSince(0);

    await library.editNote(source.id, { text: "Verify Mailgun domains before sending confirmation email." });
    const added = await wholeProject(library, "Mailgun confirmation monitoring");
    const retired = await wholeProject(library, "Mailgun confirmation history");
    await library.retire(retired.id, "Finished business");
    const { cursor: beforeRead } = await library.changesSince(0);

    const report = await worklist(library, { since: cursor });
    assert.deepEqual(report.rest?.related?.map(({ source }) => source), [source.id, added.id]);
    const related = report.rest?.related?.find((result) => result.source === source.id);
    assert.ok(related?.hits.some(({ id, score, linked }) => id === neighbour.id && score > 0 && !linked));
    assert.ok(related?.hits.every(({ id }) => ![source.id, incoming.id, outgoing.id, retired.id].includes(id)));
    assert.equal(related?.linkedCount, 2);
    assert.deepEqual((await library.changesSince(beforeRead)).changes, [], "candidate discovery writes no links");

    await link(library, source.id, neighbour.id);
    const linked = await worklist(library, { since: cursor });
    assert.ok(!linked.rest?.related?.find((result) => result.source === source.id)?.hits.some(({ id }) => id === neighbour.id));
  });
});

test("21.5 the health report names each link or supersession pointing at a record no longer live, with both ends", async () => {
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

test("21.5 the health report names a check's enforces edge pointing at a principle no longer live", async () => {
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
