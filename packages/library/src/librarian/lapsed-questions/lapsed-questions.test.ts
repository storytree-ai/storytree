/**
 * Capability 25 · Lapsed questions: contract 25.1 in The library story, in a fresh project's library on the real Postgres
 * `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "../../index.js";

import { worklist } from "../rounds/index.js";
import { withLibrary } from "../testing/pg.js";
import { openQuestions } from "./index.js";

function question(library: Library, arc: string, title: string, leaseDays?: number) {
  return library.raiseQuestion({ arc, title, stakes: "It blocks work.", statement: `${title}?`, context: "Two ways.", options: "A or B.", ...(leaseDays === undefined ? {} : { leaseDays }) });
}

test("25.1 the worklist drains only lapsed open questions across arcs, longest lapsed first", async () => {
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
