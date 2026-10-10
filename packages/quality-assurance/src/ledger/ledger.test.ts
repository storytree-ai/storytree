/**
 * Capability 3 · QA ledger: contracts 3.1 to 3.4 on the real Postgres `pnpm test` provides, through the
 * package's public entry. Each test works in projects of its own, as the ledger's one database is shared by
 * every project on the server. Contract 3.4 is also proved at the two front doors, beside their own tests,
 * because this package cannot depend back on either.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { withConnections } from "../testing/pg.js";
import { openLedger, qualityTools } from "../index.js";

const projectName = () => `t-${randomBytes(4).toString("hex")}`;

test("3.1 · recording a review writes each check's run in each package and each hit with its file and line, and a second connection reads them back", async () => {
  await withConnections(async (first, second) => {
    const project = projectName();
    const recorded = await (await openLedger(first)).record({
      project,
      review: "review-1",
      packages: ["forest-world", "library"],
      ran: [
        { check: "check_a", hits: [{ package: "forest-world", file: "src/a.test.ts", line: 12 }, { package: "library", file: "src/b.test.ts", line: 3 }] },
        { check: "check_b", hits: [] },
      ],
    });
    assert.deepEqual(recorded.hits.map(({ check, package: pkg, file, line }) => ({ check, package: pkg, file, line })), [
      { check: "check_a", package: "forest-world", file: "src/a.test.ts", line: 12 },
      { check: "check_a", package: "library", file: "src/b.test.ts", line: 3 },
    ]);

    const rows = await (await openLedger(second)).rows(project);
    assert.deepEqual(rows.runs.map(({ review, check, package: pkg }) => ({ review, check, package: pkg })), [
      { review: "review-1", check: "check_a", package: "forest-world" },
      { review: "review-1", check: "check_a", package: "library" },
      { review: "review-1", check: "check_b", package: "forest-world" },
      { review: "review-1", check: "check_b", package: "library" },
    ]);
    assert.deepEqual(rows.hits.map(({ id, review, check, package: pkg, file, line, answer }) => ({ id, review, check, package: pkg, file, line, answer })),
      recorded.hits.map(({ id, check, package: pkg, file, line }) => ({ id, review: "review-1", check, package: pkg, file, line, answer: "unanswered" })));
    for (const row of [...rows.runs, ...rows.hits]) {
      assert.equal(row.project, project);
      assert.ok(Date.now() - Date.parse(row.at) < 60_000, row.at);
    }
  });
});

test("3.1 · a hit in a package the review does not name is refused and nothing of the review is written", async () => {
  await withConnections(async (first) => {
    const project = projectName();
    const ledger = await openLedger(first);
    await assert.rejects(ledger.record({ project, review: "r", packages: ["library"], ran: [{ check: "check_a", hits: [{ package: "app", file: "x.ts", line: 1 }] }] }), /app/);
    assert.deepEqual(await ledger.rows(project), { runs: [], hits: [] });
  });
});

test("3.2 · an answer is recorded on a hit as fixed or as rejected with its reason; no reason, or a hit the ledger does not hold, is refused and nothing is written", async () => {
  await withConnections(async (first) => {
    const project = projectName();
    const other = projectName();
    const ledger = await openLedger(first);
    const { hits: [fixed, rejected, open] } = await ledger.record({ project, review: "r", packages: ["library"], ran: [{ check: "check_a", hits: [
      { package: "library", file: "a.ts", line: 1 },
      { package: "library", file: "b.ts", line: 2 },
      { package: "library", file: "c.ts", line: 3 },
    ] }] });
    await ledger.answer(project, fixed!.id, { answer: "fixed" });
    await ledger.answer(project, rejected!.id, { answer: "rejected", reason: "the expected value is a worked number" });
    await assert.rejects(ledger.answer(project, open!.id, { answer: "rejected", reason: "  " }), /reason/);
    await assert.rejects(ledger.answer(project, 0, { answer: "fixed" }), /no hit 0/);
    await assert.rejects(ledger.answer(other, open!.id, { answer: "fixed" }), new RegExp(`no hit ${open!.id}`));

    const answers = (await ledger.rows(project)).hits.map(({ answer, reason }) => ({ answer, reason }));
    assert.deepEqual(answers, [
      { answer: "fixed", reason: undefined },
      { answer: "rejected", reason: "the expected value is a worked number" },
      { answer: "unanswered", reason: undefined },
    ]);
  });
});

test("3.3 · the reading counts, per check and package, the reviews that ran it and its hits by answer; a check that never hit reads ran, and another project's rows are not counted", async () => {
  await withConnections(async (first) => {
    const project = projectName();
    const other = projectName();
    const ledger = await openLedger(first);
    const one = await ledger.record({ project, review: "r1", packages: ["library", "app"], ran: [
      { check: "check_a", hits: [{ package: "library", file: "a.ts", line: 1 }, { package: "library", file: "b.ts", line: 2 }] },
      { check: "check_b", hits: [] },
    ] });
    const two = await ledger.record({ project, review: "r2", packages: ["library"], ran: [{ check: "check_a", hits: [{ package: "library", file: "c.ts", line: 3 }] }] });
    await ledger.record({ project: other, review: "r1", packages: ["library"], ran: [{ check: "check_a", hits: [{ package: "library", file: "z.ts", line: 9 }] }] });
    await ledger.answer(project, one.hits[0]!.id, { answer: "fixed" });
    await ledger.answer(project, two.hits[0]!.id, { answer: "rejected", reason: "not computed by the code" });

    assert.deepEqual(await ledger.reading(project), [
      { check: "check_a", package: "app", reviews: 1, hits: 0, fixed: 0, rejected: 0, unanswered: 0 },
      { check: "check_a", package: "library", reviews: 2, hits: 3, fixed: 1, rejected: 1, unanswered: 1 },
      { check: "check_b", package: "app", reviews: 1, hits: 0, fixed: 0, rejected: 0, unanswered: 0 },
      { check: "check_b", package: "library", reviews: 1, hits: 0, fixed: 0, rejected: 0, unanswered: 0 },
    ]);
  });
});

test("3.4 · the tool this package registers answers the folder's project's ledger reading as data and as the text the command line prints", async () => {
  await withConnections(async (storytree) => {
    const project = projectName();
    const ledger = await openLedger(storytree);
    const review = await ledger.record({ project, review: "r1", packages: ["library"], ran: [
      { check: "check_a", hits: [{ package: "library", file: "a.ts", line: 1 }, { package: "library", file: "b.ts", line: 2 }] },
      { check: "check_b", hits: [] },
    ] });
    await ledger.answer(project, review.hits[0]!.id, { answer: "fixed" });
    await ledger.record({ project: projectName(), review: "r1", packages: ["library"], ran: [{ check: "check_a", hits: [{ package: "library", file: "z.ts", line: 9 }] }] });

    const tools: Record<string, (args: object, call: { storytree: typeof storytree; project: string }) => Promise<{ text: string; data?: Record<string, unknown> }>> = {};
    qualityTools().registerTools!((name, _description, _input, act) => { tools[name] = act as never; });
    const answer = await tools.quality_ledger!({}, { storytree, project });

    assert.equal(answer.text, [
      "QA ledger: per check and package, reviews that ran it, and its hits (fixed, rejected, unanswered):",
      "  check_a  library  ran 1, 2 hits (1 fixed, 0 rejected, 1 unanswered)",
      "  check_b  library  ran 1, no hits",
    ].join("\n"));
    assert.deepEqual(answer.data, { ledger: [
      { check: "check_a", package: "library", reviews: 1, hits: 2, fixed: 1, rejected: 0, unanswered: 1 },
      { check: "check_b", package: "library", reviews: 1, hits: 0, fixed: 0, rejected: 0, unanswered: 0 },
    ] });
  });
});
