/**
 * Capability 8 · Cloud connection (GCP), contract 8.3 (ADR-0734 D3): two accounts on one server,
 * each a member of the role that creates project databases (the laptop's owner and the Mint box's
 * service account on one Cloud SQL instance), both open, write and read one project. Tables made
 * through either belong to the database's owning role, so neither needs the other's ownership to
 * open the project again. Run here with two roles on the test server, as Cloud SQL makes them: no
 * superuser, and no right to create databases of their own.
 */
import assert from "node:assert/strict";
import { createServer, connect as openSocket, type Server } from "node:net";
import { hostname } from "node:os";
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

test("8.5 a library read refused for want of a connection slot waits for one and then succeeds", async () => {
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

/**
 * On Windows, Postgres refusing a connection for want of a slot can reset the socket before its
 * refusal (SQLSTATE 53300) reaches pg, which then reports only `read ECONNRESET`: the Windows CI
 * runner did so in 8.5 above (run 36907270707). Here a stand-in in front of the test server resets
 * the first two connections as soon as they ask in, and passes the rest through.
 */
test("8.5 a connection reset while it is being opened, as Windows delivers a full server's refusal, is asked for again and the read succeeds", async () => {
  const project = `${uniqueProjectName()}-reset`;
  const opened: Storytree[] = [];
  const target = new URL(testServerUrl());
  let resets = 2;
  const proxy: Server = createServer((client) => {
    client.on("error", () => {});
    if (resets > 0) {
      resets -= 1;
      client.once("data", () => client.resetAndDestroy());
      return;
    }
    const server = openSocket(Number(target.port || 5432), target.hostname);
    server.on("error", () => client.destroy());
    client.pipe(server).pipe(client);
  });
  try {
    const first = await connect({ url: testServerUrl() });
    opened.push(first);
    await (await first.openProject(project)).addStory({ title: "Written before the resets", description: "Read back through them." });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    assert.ok(address !== null && typeof address === "object");
    const through = new URL(target.href);
    through.hostname = "127.0.0.1";
    through.port = String(address.port);

    const second = await connect({ url: through.href });
    opened.push(second);
    const library = await second.openProject(project);

    assert.deepEqual((await library.projectTree()).stories.map((story) => story.title), ["Written before the resets"]);
    assert.equal(resets, 0, "both resets were met");
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await new Promise((resolve) => proxy.close(resolve));
    await dropTestDatabases([`storytree_${project}`]);
  }
});

test("8.6 on a shared server, each of a library's connections names the machine and process that hold it, in at most Postgres's 63 characters", async () => {
  const project = `${uniqueProjectName()}-named`;
  const opened: Storytree[] = [];
  try {
    const storytree = await connect({ url: testServerUrl() });
    opened.push(storytree);
    await (await storytree.openProject(project)).addStory({ title: "Held open", description: "Its connection is named." });

    const names = await withTestClient(async (client) =>
      (await client.query<{ name: string }>("SELECT application_name AS name FROM pg_stat_activity WHERE datname = $1", [`storytree_${project}`])).rows.map((row) => row.name),
    );

    assert.ok(names.length > 0, "the project's pool holds a connection");
    for (const name of names) {
      assert.match(name, new RegExp(`^storytree ${hostname().replace(/[^\w.-]/g, "").slice(0, 24)} ${process.pid}\\b`));
      assert.ok(name.length <= 63);
    }
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([`storytree_${project}`]);
  }
});

test("8.7 a caller that may be cut off bounds each statement, and the server ends one still running at the bound, so a cut-off process's slot comes free", async () => {
  const own = `${uniqueProjectName()}-bounded`;
  const opened: Storytree[] = [];
  try {
    // CREATE DATABASE can take longer than the query's 200 ms budget on Windows.
    // Provision it before opening the connection whose cancellation this test proves.
    const fixture = await connect({ url: testServerUrl() });
    opened.push(fixture);
    await fixture.ownDatabase(own);
    await fixture.close();

    const storytree = await connect({ url: testServerUrl(), statementTimeoutMs: 200 });
    opened.push(storytree);
    const pool = await storytree.ownDatabase(own);

    await assert.rejects(pool.query("SELECT pg_sleep(5)"), { code: "57014" });
    assert.deepEqual((await pool.query<{ n: number }>("SELECT 1 AS n")).rows, [{ n: 1 }]);
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([own]);
  }
});

/**
 * A project's database held to one connection, which a test client holds while `during` runs:
 * Postgres refuses the library's own connections there (SQLSTATE 53300), as a full server does.
 */
async function withFullDatabase<T>(during: (url: string, project: string) => Promise<T>): Promise<T> {
  const run = uniqueProjectName();
  const lane = `${run}-lane@storytree.test`;
  const project = `${run}-full`;
  try {
    await createTestRole(lane, { createdb: true });
    const first = await connect({ url: as(lane) });
    try {
      await (await first.openProject(project)).addStory({ title: "Written before the rush", description: "Read back under it." });
    } finally {
      await first.close();
    }
    await withTestClient((client) => client.query(`ALTER DATABASE "storytree_${project}" CONNECTION LIMIT 1`));
    return await during(as(lane), project);
  } finally {
    await dropTestDatabases([`storytree_${project}`]);
    await dropTestRoles([lane]);
  }
}

test("8.8 a library call kept waiting for a connection slot says once what it waits for, then goes on when one comes free", async () => {
  await withFullDatabase(async (url, project) => {
    const said: string[] = [];
    const storytree = await connect({ url, onWait: (what) => said.push(what) });
    try {
      let reading: Promise<string[]> | undefined;
      await withTestClient(async () => {
        reading = storytree.openProject(project).then(async (library) => (await library.projectTree()).stories.map((story) => story.title));
        reading.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 800));
      }, `storytree_${project}`);

      assert.deepEqual(await reading, ["Written before the rush"]);
      assert.equal(said.length, 1, `said once: ${JSON.stringify(said)}`);
      assert.match(said[0] ?? "", /connection slot/);
      assert.match(said[0] ?? "", /too many connections/, "with the server's reason");
    } finally {
      await storytree.close();
    }
  });
});

test("8.8 a library call still refused a connection slot at its wait bound fails with the server's reason", async () => {
  await withFullDatabase(async (url, project) => {
    const said: string[] = [];
    const storytree = await connect({ url, waitMs: 300, onWait: (what) => said.push(what) });
    try {
      await withTestClient(async () => {
        const started = Date.now();
        await assert.rejects(storytree.openProject(project), /too many connections/);
        assert.ok(Date.now() - started < 3_000, "given up at the bound");
      }, `storytree_${project}`);
      assert.equal(said.length, 1);
    } finally {
      await storytree.close();
    }
  });
});

/** Run `during` while a test client holds `project`'s write lock, released when `during` ends. */
async function withWriteLockHeld<T>(project: string, during: () => Promise<T>): Promise<T> {
  return withTestClient(async (client) => {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
    try {
      return await during();
    } finally {
      await client.query("COMMIT");
    }
  }, `storytree_${project}`);
}

test("8.8 a write kept waiting for another session's write says what it waits for, then is written when that ends", async () => {
  const project = `${uniqueProjectName()}-turns`;
  const said: string[] = [];
  const storytree = await connect({ url: testServerUrl(), onWait: (what) => said.push(what) });
  try {
    const library = await storytree.openProject(project);
    let writing: Promise<unknown> | undefined;
    await withWriteLockHeld(project, async () => {
      writing = library.addStory({ title: "Written after its turn", description: "Waited for another write." });
      writing.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await writing;

    assert.deepEqual((await library.projectTree()).stories.map((story) => story.title), ["Written after its turn"]);
    assert.equal(said.length, 1, `said once: ${JSON.stringify(said)}`);
    assert.match(said[0] ?? "", /another session is writing/);
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${project}`]);
  }
});

test("8.8 a write still kept waiting for another session's write at its wait bound fails with the reason and writes nothing", async () => {
  const project = `${uniqueProjectName()}-stuck`;
  const storytree = await connect({ url: testServerUrl(), waitMs: 300, onWait: () => {} });
  try {
    const library = await storytree.openProject(project);
    await withWriteLockHeld(project, async () => {
      const started = Date.now();
      await assert.rejects(library.addStory({ title: "Never written", description: "Its turn never came." }), /writing.*lock timeout/s);
      assert.ok(Date.now() - started < 3_000, "given up at the bound");
    });
    assert.deepEqual((await library.projectTree()).stories, []);
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${project}`]);
  }
});
