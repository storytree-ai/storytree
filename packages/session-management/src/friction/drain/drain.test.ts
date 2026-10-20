/**
 * Capability 17 · Friction, its drain and route: one test per contract 17.8-17.14, each in a fresh
 * project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { frictionDrain, LEASE_MINUTES, openFriction, route } from "../index.js";

function friction(library: Library, title: string, branch?: string) {
  return library.writeKnowledge("friction", {
    title,
    description: `${title}.`,
    statement: `${title}.`,
    evidence: "`pnpm seed:library` printed: Quit the app, then run `pnpm seed:library` again.",
    impact: "Work stops.",
    ...(branch === undefined ? {} : { provenance: { branch, date: "2026-09-27", source: "retro" as const } }),
  });
}

test("17.8 · the friction drain takes three open reports from other branches, most recurrences first and oldest first on ties", async () => {
  await withLibrary(async (library) => {
    const own = await friction(library, "Own report", "claude/me");
    const routed = await friction(library, "Routed report", "claude/other");
    const a = await friction(library, "Report A", "claude/other");
    const b = await friction(library, "Report B");
    const c = await friction(library, "Report C", "codex/third");
    const d = await friction(library, "Report D", "claude/other");
    await friction(library, "Report E", "claude/other");
    for (const [report, count] of [[own, 5], [routed, 6], [b, 1], [c, 2], [d, 1]] as const) {
      await library.editNote(report.id, { reinforcedBy: Array.from({ length: count }, (_, index) => ({
        branch: `repeat/${index}`, date: "2026-09-28", evidence: `#${index + 1}: happened again`,
      })) });
    }
    // Judged after its recurrences: a recurrence on a settled report would reopen it (5.6).
    await route(library, routed.id, "nothing", "A one-off: the app was open.");

    const drain = await frictionDrain(library, { branch: "claude/me" });
    assert.deepEqual(drain.map((one) => one.id), [c.id, b.id, d.id]);
    assert.ok(!drain.some((one) => one.id === own.id));
    await route(library, c.id, "nothing", "Resolved upstream");
    assert.deepEqual((await frictionDrain(library, { branch: "claude/me" })).map((one) => one.id), [b.id, d.id, a.id]);
  });
});

test("17.9 · route records the routing judgement with its reason, and refuses a route with no reason", async () => {
  await withLibrary(async (library) => {
    const report = await friction(library, "Seed refused", "claude/other");
    const { cursor } = await library.changesSince(0);
    await assert.rejects(route(library, report.id, "tool", " "), /reason/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    await route(library, report.id, "nothing", "The app was open; no remedy is needed.");
    const [found] = await library.search("Seed refused");
    assert.equal(found?.type === "friction" ? found.fields.route : undefined, "nothing");
    assert.equal(found?.type === "friction" ? found.fields.routeReason : undefined, "The app was open; no remedy is needed.");
  });
});

test("17.10 · a tool route needs an open increment naming this friction, unless a delivered remedy is stamped", async () => {
  await withLibrary(async (library) => {
    const report = await friction(library, "Seed refused", "claude/other");
    const arc = await library.createArc({ title: "Seeding", intent: "Seed live", endState: "Seed works" });
    const increment = { arc: arc.id, title: "Fix seeding", objective: "Use running Postgres", body: "Build the fix" };
    await library.addIncrement(increment); // An unrelated live increment proves nothing.
    await library.addIncrement({ ...increment, remedies: [report.id], outcome: { disposition: "landed", pr: "#1" } });
    const history = await library.history();
    await assert.rejects(route(library, report.id, "tool", "Fix seeding"), /live increment.*remedies/);
    assert.deepEqual(await library.history(), history, "neither an unrelated nor a closed increment permits a forward route");

    const remedy = await library.addIncrement({ ...increment, remedies: [report.id] });
    const routed = await route(library, report.id, "tool", "Fix seeding", { actor: "session:curator" });
    assert.equal(routed.fields.route, "tool");
    assert.equal(routed.fields.dischargedBy, undefined);
    assert.equal((await library.history({ id: report.id })).at(-1)?.actor, "session:curator");
    await library.closeIncrement(remedy.id, { disposition: "landed", pr: "#2" });

    const delivered = await route(library, report.id, "tool", "Fix landed", { dischargedBy: "  #2  " });
    assert.equal(delivered.fields.dischargedBy, "#2", "an already-routed report accepts a later, trimmed delivery stamp");
    const preserved = await route(library, report.id, "tool", "Clarify the delivered fix");
    assert.equal(preserved.fields.dischargedBy, "#2", "omitting the stamp preserves it and exempts delivered work from the open-increment fence");
    assert.equal(preserved.fields.evidence, report.fields.evidence);
    const afterDelivery = await library.history();
    await assert.rejects(route(library, report.id, "tool", "Blank reference", { dischargedBy: " \n " }), /dischargedBy.*non-empty/);
    assert.deepEqual(await library.history(), afterDelivery);
  });
});

test("17.11 · a report already routed is routed again only to the same route; routing it elsewhere is refused naming the earlier route and its reason, and nothing is written (regression, 2026-10-01: two passes 23 s apart, the later route silently replacing the earlier)", async () => {
  await withLibrary(async (library) => {
    const report = await friction(library, "Seed refused", "claude/other");
    await route(library, report.id, "edit-existing", "Edited the seeding note in place.", { dischargedBy: "#8" });
    const history = await library.history();

    await assert.rejects(route(library, report.id, "nothing", "A one-off."), /already routed to edit-existing: Edited the seeding note in place\./);
    assert.deepEqual(await library.history(), history, "nothing was written");

    const again = await route(library, report.id, "edit-existing", "Edited the seeding note, and its example.");
    assert.equal(again.fields.routeReason, "Edited the seeding note, and its example.", "the same route takes a clearer reason");
  });
});

test("17.12 · every route but nothing needs an open increment remedying the report or a delivery stamp, and the drain offers a reopened report again, to be routed afresh", async () => {
  await withLibrary(async (library) => {
    const arc = await library.createArc({ title: "Seeding", intent: "Seed live", endState: "Seed works" });
    for (const to of ["adr", "principle", "guardrail", "process", "definition", "edit-existing"] as const) {
      const report = await friction(library, `Seed refused (${to})`, "claude/other");
      const history = await library.history();
      await assert.rejects(route(library, report.id, to, "Write it down"), new RegExp(`routing to ${to} needs a live increment whose remedies names ${report.id}`));
      assert.deepEqual(await library.history(), history, `an ${to} route with no remedy writes nothing`);

      await library.addIncrement({ arc: arc.id, title: "Write it down", objective: "Record it", body: "Record it", remedies: [report.id] });
      assert.equal((await route(library, report.id, to, "Write it down")).fields.state, "routed", `an ${to} route with its remedy parked is routed`);
      const stamped = await friction(library, `Seed refused again (${to})`, "claude/other");
      assert.equal((await route(library, stamped.id, to, "Already written", { dischargedBy: "#5" })).fields.state, "resolved", `an ${to} route carrying its stamp is resolved`);
    }
    const dismissed = await friction(library, "A one-off", "claude/other");
    assert.equal((await route(library, dismissed.id, "nothing", "The app was open")).fields.state, "dismissed", "nothing needs no remedy");

    assert.deepEqual((await frictionDrain(library, { branch: "claude/me" })).map(({ id }) => id), [], "settled and routed reports are not offered");
    await library.editNote(dismissed.id, { reinforcedBy: [{ branch: "codex/again", date: "2026-10-12", evidence: "`pnpm seed` refused again" }] });
    assert.deepEqual((await frictionDrain(library, { branch: "claude/me" })).map(({ id }) => id), [dismissed.id], "a recurrence puts it back in the drain");
    const rerouted = await route(library, dismissed.id, "guardrail", "It recurs: refuse it", { dischargedBy: "#6" });
    assert.deepEqual([rerouted.fields.route, rerouted.fields.state], ["guardrail", "resolved"], "a reopened report is judged afresh, on any route");
  });
});

test("17.13 · the friction drain leases what it lists to the session that asked: a second session draining meanwhile gets the next unleased reports, a route ends the lease, and a lapsed lease frees the report", async () => {
  await withLibrary(async (library) => {
    for (const name of ["A", "B", "C", "D", "E"]) await friction(library, `Report ${name}`, "claude/other");
    // Reports written in one millisecond can tie on creation order, so take the order the drain lists.
    const [a, b, c, d, e] = await openFriction(library, { branch: "claude/me" });
    const one = { actor: "session:one" };
    const two = { actor: "session:two" };
    const ids = async (writer: { actor: string }, now?: Date) =>
      (await frictionDrain(library, { branch: "claude/me", writer, ...(now === undefined ? {} : { now }) })).map(({ id }) => id);

    assert.deepEqual(await ids(one), [a!.id, b!.id, c!.id]);
    assert.deepEqual(await ids(two), [d!.id, e!.id], "the second session is not handed the first one's reports");
    assert.deepEqual(await ids(one), [a!.id, b!.id, c!.id], "the session that holds them is handed them again");

    const routed = await route(library, a!.id, "nothing", "A one-off.", one);
    assert.equal(routed.fields.lease, undefined, "routing a report ends its lease");

    const lapsed = new Date(Date.now() + (LEASE_MINUTES + 1) * 60_000);
    assert.deepEqual(await ids(two, lapsed), [b!.id, c!.id, d!.id], "a lapsed lease frees its reports for another session");
  });
});

test("17.13 · two sessions draining at the same moment are never handed the same report", async () => {
  await withLibrary(async (library) => {
    for (const name of ["A", "B", "C", "D", "E", "F"]) await friction(library, `Report ${name}`, "claude/other");
    const [first, second] = await Promise.all(["session:one", "session:two"].map((actor) => frictionDrain(library, { branch: "claude/me", writer: { actor } })));
    const handed = [...first!, ...second!].map(({ id }) => id);
    assert.equal(handed.length, 6);
    assert.equal(new Set(handed).size, 6, "no report is handed to both");
  });
});

test("17.14 · route checks whether a report is already routed inside its write: a pass that read the report before another pass's route committed is refused, and nothing is written (regression, friction_2a561540827c: routed both ways 12 s apart)", async () => {
  await withLibrary(async (library) => {
    const report = await friction(library, "Seed refused", "claude/other");
    // The later pass read the notes before the earlier pass's route committed: its reads stay as they were.
    const read = await library.search("");
    const late = new Proxy(library, {
      get(target, key) {
        if (key === "search") return async () => read;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await route(library, report.id, "edit-existing", "Edited the seeding note.", { dischargedBy: "#8" });
    const { cursor } = await library.changesSince(0);

    await assert.rejects(route(late, report.id, "nothing", "A one-off."), /already routed to edit-existing: Edited the seeding note\./);
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");
  });
});
