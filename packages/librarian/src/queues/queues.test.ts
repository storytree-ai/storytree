/**
 * Capability 5 · Queues: one test per contract 5.1-5.3 in the librarian story, each in a fresh
 * project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { withLibrary } from "../testing/pg.js";
import { frictionDrain, openQuestions, route } from "./index.js";

function question(library: Library, arc: string, title: string) {
  return library.raiseQuestion({ arc, title, stakes: "It blocks work.", statement: `${title}?`, context: "Two ways.", options: "A or B." });
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

test("5.1 the worklist lists every open question on every arc, oldest first", async () => {
  await withLibrary(async (library) => {
    const launch = await library.createArc({ title: "Launch", intent: "Ship", endState: "Shipped" });
    const polish = await library.createArc({ title: "Polish", intent: "Tidy", endState: "Tidy" });
    const first = await question(library, polish.id, "Which font");
    const settled = await question(library, launch.id, "Which mailer");
    const second = await question(library, launch.id, "Which host");
    await library.settleQuestion(settled.id, { answer: "Mailgun" });

    assert.deepEqual((await openQuestions(library)).map((one) => one.id), [first.id, second.id]);
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
