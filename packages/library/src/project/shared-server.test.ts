/**
 * Capability 8 · Cloud connection (GCP), contract 8.3 (ADR-0734 D3): two accounts on one server,
 * each a member of the role that creates project databases (the laptop's owner and the Mint box's
 * service account on one Cloud SQL instance), both open, write and read one project. Tables made
 * through either belong to the database's owning role, so neither needs the other's ownership to
 * open the project again. Run here with two roles on the test server, as Cloud SQL makes them: no
 * superuser, and no right to create databases of their own.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";

import { createTestRole, dropTestDatabases, dropTestRoles, testServerUrl, uniqueProjectName, withTestClient } from "../testing/pg.js";

function as(user: string): string {
  const url = new URL(testServerUrl());
  url.username = user;
  return url.href;
}

test("8.3 two accounts sharing the creator role both open, write and read one project, and one's own database, on one server", async () => {
  const run = uniqueProjectName();
  const [laptop, mint, creator] = [`${run}-laptop@storytree.test`, `${run}-mint@storytree.test`, `${run}-creator`];
  const project = `${run}-shared`;
  const own = `${run}-own`;
  const opened: Storytree[] = [];
  try {
    await createTestRole(laptop, { createdb: false });
    await createTestRole(mint, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient(async (client) => {
      await client.query(`GRANT "${creator}" TO "${laptop}"`);
      await client.query(`GRANT "${creator}" TO "${mint}"`);
    });
    const first = await connect({ url: as(laptop) });
    opened.push(first);
    const onLaptop = await first.openProject(project);
    await onLaptop.addStory({ title: "From the laptop", description: "Written first." });
    const log = await first.ownDatabase(own);
    await log.query("CREATE TABLE IF NOT EXISTS line (n int)");
    await log.query("CREATE INDEX IF NOT EXISTS line_n ON line (n)");

    const second = await connect({ url: as(mint) });
    opened.push(second);
    const onMint = await second.openProject(project);
    await onMint.addStory({ title: "From the Mint box", description: "Written second." });
    const mintLog = await second.ownDatabase(own);
    await mintLog.query("CREATE INDEX IF NOT EXISTS line_n ON line (n)");
    await mintLog.query("INSERT INTO line VALUES (1)");

    for (const library of [onLaptop, onMint]) {
      assert.deepEqual((await library.projectTree()).stories.map((story) => story.title).sort(), ["From the Mint box", "From the laptop"]);
    }
    assert.equal((await log.query<{ n: number }>("SELECT count(*)::int AS n FROM line")).rows[0]?.n, 1);
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([`storytree_${project}`, own]);
    await dropTestRoles([laptop, mint, creator]);
  }
});

test("8.4 a library read refused for want of a connection slot waits for one and then succeeds", async () => {
  const run = uniqueProjectName();
  const lane = `${run}-lane@storytree.test`;
  const project = `${run}-busy`;
  const opened: Storytree[] = [];
  try {
    await createTestRole(lane, { createdb: true });
    const first = await connect({ url: as(lane) });
    opened.push(first);
    await (await first.openProject(project)).addStory({ title: "Written before the rush", description: "Read back under it." });
    await first.close();
    // One slot on the project's database, and another client holds it for a moment: Postgres
    // refuses a new connection there (SQLSTATE 53300) as a full server does.
    await withTestClient((client) => client.query(`ALTER DATABASE "storytree_${project}" CONNECTION LIMIT 1`));

    const second = await connect({ url: as(lane) });
    opened.push(second);
    let reading: Promise<string[]> | undefined;
    await withTestClient(async () => {
      reading = second.openProject(project).then(async (library) => (await library.projectTree()).stories.map((story) => story.title));
      reading.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }, `storytree_${project}`);

    assert.deepEqual(await reading, ["Written before the rush"]);
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([`storytree_${project}`]);
    await dropTestRoles([lane]);
  }
});
