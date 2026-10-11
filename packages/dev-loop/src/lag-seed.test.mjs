// The lag seed (packages/dev-loop/src/lag-seed.mjs), the one library both lag instruments seed, against the real Postgres
// `pnpm test` provides.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { chooseIsland, NAMED_STORY } from "@storytree/forest/actions";
import { connect } from "@storytree/library";
import { openActivityLog } from "@storytree/session-management";

import { SIZES, seedLagProject } from "./lag-seed.mjs";
import { ALL_READS, measureReads } from "./read-latency.mjs";

/** What a seeded project holds, counted as the page reads it. */
async function contents(storytree, url, project) {
  const library = await storytree.openProject(project);
  const tree = await library.projectTree();
  const arcs = await library.arcViews();
  const log = await openActivityLog(url);
  try {
    const { lines } = await log.since(project, 0);
    return {
      stories: tree.stories.map((story) => story.title),
      capabilities: tree.stories.map((story) => story.capabilities.length),
      contracts: tree.stories.flatMap((story) => story.capabilities).reduce((sum, capability) => sum + capability.contracts.length, 0),
      arcs: arcs.length,
      increments: arcs.reduce((sum, arc) => sum + arc.increments.length, 0),
      questions: arcs.reduce((sum, arc) => sum + arc.questions.length, 0),
      lines: lines.length,
      sessions: new Set(lines.map((line) => line.session)).size,
    };
  } finally {
    await log.close();
  }
}

test("8.5 two seedings of the standard size hold the same library and its reads make the same queries", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const projects = [`t-${randomBytes(4).toString("hex")}`, `t-${randomBytes(4).toString("hex")}`];
  const storytree = await connect({ url });
  try {
    const seen = [];
    for (const project of projects) {
      await seedLagProject(storytree, url, project, "standard");
      seen.push({ contents: await contents(storytree, url, project), queries: await measureReads({ storytree, project, delayMs: 0, rounds: 1, reads: ALL_READS }) });
    }
    assert.deepEqual(seen[0].contents, {
      stories: [NAMED_STORY, "Story 2", "Story 3", "Story 4", "Story 5"], capabilities: [3, 4, 5, 1, 2], contracts: 30,
      arcs: 25, increments: 200, questions: 25, lines: 40, sessions: 4,
    });
    assert.deepEqual(seen[1].contents, seen[0].contents);
    assert.deepEqual(seen[1].queries.map(({ read, queries }) => ({ read, queries })), seen[0].queries.map(({ read, queries }) => ({ read, queries })));
    assert.ok(seen[0].queries.every(({ queries }) => queries > 0), "every read asks the library");
    // The catalogue's three islands are three different stories on the seed.
    const islands = (await (await storytree.openProject(projects[0])).projectTree()).stories.map((story) => ({ story: story.id, title: story.title, capabilities: story.capabilities.length }));
    assert.equal(new Set([chooseIsland("fewest", islands), chooseIsland("most", islands), chooseIsland({ story: NAMED_STORY }, islands)]).size, 3);
  } finally {
    for (const project of projects) await storytree.dropProject(project).catch(() => {});
    await storytree.close();
  }
});

test("8.5 the large seed is ten times the standard one's breadth at the same depth", () => {
  const { standard, large } = SIZES;
  for (const part of ["arcs", "stories", "sessions", "logLines"]) assert.equal(large[part], standard[part] * 10, part);
  for (const part of ["incrementsPerArc", "capabilitiesPerStory", "contractsPerCapability"]) assert.equal(large[part], standard[part], part);
});
