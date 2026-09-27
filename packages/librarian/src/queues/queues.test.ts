/**
 * Capability 5 · Queues: one test per contract 5.1-5.3 in the librarian story, each in a fresh
 * project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { worklist } from "../rounds/index.js";
import { withLibrary } from "../testing/pg.js";
import { frictionDrain, openQuestions, route } from "./index.js";

function question(library: Library, arc: string, title: string, leaseDays?: number) {
  return library.raiseQuestion({ arc, title, stakes: "It blocks work.", statement: `${title}?`, context: "Two ways.", options: "A or B.", ...(leaseDays === undefined ? {} : { leaseDays }) });
}

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

test("5.1 the worklist drains only lapsed open questions across arcs, longest lapsed first", async () => {
  await withLibrary(async (library) => {
    const launch = await library.createArc({ title: "Launch", intent: "Ship", endState: "Shipped" });
    const polish = await library.createArc({ title: "Polish", intent: "Tidy", endState: "Tidy" });
    const first = await question(library, polish.id, "Which font", 3);
    const settled = await question(library, launch.id, "Which mailer", 1);
    const second = await question(library, launch.id, "Which host", 1);
    await question(library, polish.id, "Which colour");
    await library.settleQuestion(settled.id, { answer: "Mailgun" });
    const { cursor } = await library.changesSince(0);

    assert.deepEqual(await openQuestions(library), [], "fresh questions are not due for review");
    const now = new Date(Date.parse(first.fields.verifiedAt!) + 4 * 86_400_000);
    const report = await worklist(library, { now });
    assert.deepEqual(report.rest?.questions.map((one) => one.id), [second.id, first.id], "order by lease expiry, not creation");
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "gathering the drain neither settles nor renews");

    await library.settleQuestion(second.id, { answer: "Use the existing host" });
    assert.deepEqual((await worklist(library, { now })).rest?.questions.map((one) => one.id), [first.id]);
  });
});

test("5.2 the friction drain holds at most the three oldest unrouted reports another session filed", async () => {
  await withLibrary(async (library) => {
    const own = await friction(library, "Own report", "claude/me");
    const routed = await friction(library, "Routed report", "claude/other");
    await route(library, routed.id, "nothing", "A one-off: the app was open.");
    const a = await friction(library, "Report A", "claude/other");
    const b = await friction(library, "Report B");
    const c = await friction(library, "Report C", "codex/third");
    await friction(library, "Report D", "claude/other");

    const drain = await frictionDrain(library, { branch: "claude/me" });
    assert.deepEqual(drain.map((one) => one.id), [a.id, b.id, c.id]);
    assert.ok(!drain.some((one) => one.id === own.id));
  });
});

test("5.3 route records the routing judgement with its reason, and refuses a route with no reason", async () => {
  await withLibrary(async (library) => {
    const report = await friction(library, "Seed refused", "claude/other");
    const { cursor } = await library.changesSince(0);
    await assert.rejects(route(library, report.id, "tool", " "), /reason/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    await route(library, report.id, "tool", "The seed could reach the app's running Postgres instead of refusing.");
    const [found] = await library.search("Seed refused");
    assert.equal(found?.type === "friction" ? found.fields.route : undefined, "tool");
    assert.equal(found?.type === "friction" ? found.fields.routeReason : undefined, "The seed could reach the app's running Postgres instead of refusing.");
  });
});
