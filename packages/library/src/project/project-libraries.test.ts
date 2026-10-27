/**
 * Capability 1 · Project libraries: one test per contract in the library story.
 *
 * These run against the real Postgres that `pnpm test` provides. Every project a test makes is
 * named with uniqueProjectName() and its databases are dropped at the end, pass or fail, so tests
 * can share one server, and run beside other test files, without seeing each other's projects.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client } from "pg";

import { quietFor, waitUntil } from "@storytree/test-waits";

import { createTestRole, dropTestDatabases, dropTestRoles, testRoleUrl as as, testServerUrl, uniqueProjectName, withTestClient, withTestClientAs } from "../testing/pg.js";
import { ConnectionError, ProjectGoneError, connect, type Project, type Storytree } from "./index.js";
import type { InheritedRecords } from "./factory.js";
import type { FieldsOf, RecordType } from "../schema/index.js";

/** The spec's naming, restated here rather than taken from the code: project `x` is database `storytree_x`. */
function databaseOf(project: string): string {
  return `storytree_${project}`;
}

/**
 * Run `body` with a fresh connection to the test server. Afterwards close it and drop
 * `databases`, whether the body passed or failed.
 */
async function withStorytree(
  databases: readonly string[],
  body: (storytree: Storytree) => Promise<void>,
): Promise<void> {
  let storytree: Storytree | undefined;
  try {
    storytree = await connect({ url: testServerUrl() });
    await body(storytree);
  } finally {
    try {
      await storytree?.close();
    } finally {
      await dropTestDatabases(databases);
    }
  }
}

/** The databases on the test server whose names contain `token`, in byte order. */
async function databasesContaining(token: string): Promise<string[]> {
  return withTestClient(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE strpos(datname, $1) > 0 ORDER BY datname COLLATE "C"`,
      [token],
    );
    return rows.map((row) => row.datname);
  });
}

/** A project database's library_meta rows as { key: value }, read over an independent connection. */
async function metaOf(database: string): Promise<Record<string, string>> {
  return withTestClient(async (client) => {
    const { rows } = await client.query<{ key: string; value: string }>("SELECT key, value FROM library_meta");
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }, database);
}

/** The database a project's pool is actually connected to. */
async function connectedDatabase(project: Project): Promise<string | undefined> {
  const { rows } = await project.pool.query<{ db: string }>("SELECT current_database() AS db");
  return rows[0]?.db;
}

test("1.1 openProject creates the project's database and its tables, and gives a project set up before a table changed what was added since", async () => {
  const name = uniqueProjectName();
  await withStorytree([databaseOf(name)], async (storytree) => {
    assert.deepEqual(await databasesContaining(name), [], "precondition: the project has no database yet");

    const project = await storytree.openProject(name);

    assert.equal(project.name, name);
    assert.deepEqual(await databasesContaining(name), [databaseOf(name)], "its database is storytree_<name>");
    // Its tables exist, seen from outside the library: library_meta, holding the project's name.
    assert.equal((await metaOf(databaseOf(name))).project, name);

    // A project set up before a table gained a column gains it at its next open: feedback_screenshot's element_jpeg,
    // where a feedback note's crop is kept (Library API 7.18).
    const cropColumn = () => withTestClient(async (client) => (await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'feedback_screenshot' AND column_name = 'element_jpeg'")).rowCount, databaseOf(name));
    assert.equal(await cropColumn(), 1);
    await withTestClient((client) => client.query("ALTER TABLE feedback_screenshot DROP COLUMN element_jpeg; DELETE FROM library_meta WHERE key = 'schema'"), databaseOf(name));
    assert.equal(await cropColumn(), 0, "precondition: a project set up before the crop");
    const later = await connect({ url: testServerUrl() });
    try {
      const reopened = await later.openProject(name);
      assert.equal(await cropColumn(), 1, "the column is added at the next open");
      await reopened.pool.query("INSERT INTO feedback_screenshot (record_id, jpeg, element_jpeg) VALUES ('feedback_000000000001', '\\xffd8', '\\xffd9')");
    } finally {
      await later.close();
    }
  });
});

test("1.2 opening the same project again succeeds and changes nothing", async () => {
  const name = uniqueProjectName();
  const raced = uniqueProjectName();
  await withStorytree([databaseOf(name), databaseOf(raced)], async (storytree) => {
    const first = await storytree.openProject(name);
    await first.pool.query("INSERT INTO library_meta (key, value) VALUES ('probe', 'saved before reopening')");
    const before = await metaOf(databaseOf(name));
    assert.equal(before.probe, "saved before reopening");

    // Open it again from a second connection, as a new process would.
    const later = await connect({ url: testServerUrl() });
    try {
      const again = await later.openProject(name);

      assert.equal(again.name, name);
      assert.deepEqual(await databasesContaining(name), [databaseOf(name)], "no second database");
      assert.deepEqual(await metaOf(databaseOf(name)), before, "its records are untouched");

      // Two first opens of one project racing each other are just as safe: both succeed and
      // there is one database, set up once.
      const both = await Promise.all([storytree.openProject(raced), later.openProject(raced)]);
      assert.deepEqual(both.map((project) => project.name), [raced, raced]);
      assert.deepEqual(await databasesContaining(raced), [databaseOf(raced)]);
      assert.equal((await metaOf(databaseOf(raced))).project, raced);
    } finally {
      await later.close();
    }
  });
});

test("1.13 closing waits for an opening project and concurrent closers, then releases its connections", async () => {
  const name = uniqueProjectName();
  await withStorytree([databaseOf(name)], async (storytree) => {
    await (await storytree.openProject(name)).close();
    let project: Project | undefined;
    let finishedWhileOpening: boolean[] | undefined;
    try {
      await withTestClient(async (blocker) => {
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE library_meta IN ACCESS EXCLUSIVE MODE");
        const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
        const opening = storytree.openProject(name).then((opened) => { project = opened; });
        let closing: Promise<void>[] = [];
        try {
          await waitUntil(async () => {
            await blocker.query("SELECT pg_stat_clear_snapshot()");
            const { rows } = await blocker.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))", [pid],
            );
            return rows.length > 0;
          }, 5_000, "the project opening to reach the held schema read");
          const finished = [false, false];
          closing = finished.map((_, i) => storytree.close().then(() => { finished[i] = true; }));
          await new Promise((resolve) => setImmediate(resolve));
          finishedWhileOpening = [...finished];
        } finally {
          await blocker.query("ROLLBACK");
          await opening;
          await Promise.all(closing);
        }
      }, databaseOf(name));
      assert.ok(project?.pool.ended, "shutdown includes the project that finished opening during it");
      assert.deepEqual(finishedWhileOpening, [false, false], "neither close finishes while the project is still opening");
      await assert.rejects(project.transactions.get("after-close"), /pool after calling end/);
      await withTestClient(async (observer) => {
        // A backend leaves pg_stat_activity a moment after its client disconnects (the blocker's
        // too), so wait for the count to reach zero rather than reading it once.
        await waitUntil(async () => {
          const { rows } = await observer.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1", [databaseOf(name)],
          );
          return rows[0]?.n === 0;
        }, 5_000, "no project connection to be left on Postgres");
      });
    } finally {
      // Also cleans up the orphan when this regression is run against the broken implementation.
      await project?.close();
    }
  });
});

test("1.13 closing refuses new openings and every caller waits for an own-database client to return", async () => {
  const name = uniqueProjectName();
  const own = `${name}-own`;
  await withStorytree([databaseOf(name), own], async (storytree) => {
    await (await storytree.openProject(name)).close();
    const pool = await storytree.ownDatabase(own);
    const client = await pool.connect();
    const finished = [false, false];
    const closing = finished.map((_, i) => storytree.close().then(() => { finished[i] = true; }));
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(finished, [false, false], "both closers wait for the checked-out connection");
      await assert.rejects(storytree.openProject(name), /closed/i);
      await assert.rejects(storytree.ownDatabase(own), /closed/i);
    } finally {
      client.release();
      await Promise.all(closing);
    }
    assert.ok(pool.ended);
    await assert.rejects(storytree.openProject(name), /closed/i);
    await assert.rejects(storytree.ownDatabase(own), /closed/i);
  });
});

test("1.2 reopening while a record write is in flight does not deadlock (PR 75 macOS CLI incident)", async () => {
  const name = uniqueProjectName();
  await withStorytree([databaseOf(name)], async (storytree) => {
    const project = await storytree.openProject(name);
    // A current project's reopen writes nothing and takes no lock (1.10); one whose tables are
    // behind sets them up, under the locks this is about.
    await project.pool.query("DELETE FROM library_meta WHERE key = 'schema'");
    const later = await connect({ url: testServerUrl() });
    try {
      await withTestClient(async (writer) => {
        // Pause the real SQL write after its history append, before it saves the current record.
        // This is the lock order of PgTransactions.save, made deterministic rather than raced.
        await writer.query("BEGIN");
        await writer.query("SET LOCAL statement_timeout = '5s'");
        await writer.query("SELECT pg_advisory_xact_lock(hashtext('storytree.record-writes'))");
        const pid = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
        await writer.query("SELECT id FROM record WHERE id = 'during-open' FOR UPDATE");
        await writer.query("INSERT INTO record_event (record_id, type, action, record) VALUES ('during-open', 'decision', 'created', '{}'::jsonb)");
        const opening = later.openProject(name).then(() => undefined, (error: unknown) => error);
        try {
          await waitUntil(async () => {
            const { rows } = await project.pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))",
              [pid],
            );
            return rows.length > 0;
          }, 5_000, "the second open to reach the in-flight write");
          const saved = await writer.query("INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ('during-open', 'decision', 1, '{}'::jsonb, now(), now())")
            .then(() => writer.query("COMMIT"))
            .then(() => undefined, async (error: unknown) => { await writer.query("ROLLBACK"); return error; });
          const opened = await opening;
          assert.equal(saved, undefined, "the in-flight write completes");
          assert.equal(opened, undefined, "the concurrent open completes");
          assert.equal((await project.transactions.get("during-open"))?.id, "during-open");
        } finally {
          await writer.query("ROLLBACK");
          await opening;
        }
      }, databaseOf(name));
    } finally {
      await later.close();
    }
  });
});

test("1.3 listProjects returns exactly the storytree projects, sorted, and no other database", async () => {
  const run = uniqueProjectName();
  const site = `${run}-site`;
  const app = `${run}-app`;
  // Databases on the same server that are NOT storytree projects, including near misses that a
  // loose match would take: '_' is a LIKE wildcard, ILIKE ignores case, and the prefix must lead.
  const others = [run, `storytree-${run}`, `Storytree_${run}`, `xstorytree_${run}`];
  await withStorytree([databaseOf(site), databaseOf(app), ...others], async (storytree) => {
    await withTestClient(async (client) => {
      for (const database of others) await client.query(`CREATE DATABASE "${database}"`);
    });
    await storytree.openProject(site); // opened first, listed second: the order is the sort's
    await storytree.openProject(app);

    const listed = await storytree.listProjects();

    // The server is shared with other tests, so "exactly" is judged on the names this test made:
    // whatever is listed that carries this run's token must be precisely app and site.
    const token = run.slice("t-".length);
    assert.deepEqual(listed.filter((project) => project.includes(token)), [app, site]);
    assert.deepEqual(listed, [...listed].sort(), "the list is sorted");
  });
});

test("1.12 dropProject deletes a project's database and every record in it; it is listed no more, and an unknown project is refused", async () => {
  const run = uniqueProjectName();
  const site = `${run}-site`;
  const kept = `${run}-kept`;
  await withStorytree([databaseOf(site), databaseOf(kept)], async (storytree) => {
    const library = await storytree.openProject(site);
    await library.pool.query("INSERT INTO library_meta (key, value) VALUES ('drop-probe', 'here')");
    await storytree.openProject(kept);

    await storytree.dropProject(site);

    assert.deepEqual(await databasesContaining(run.slice("t-".length)), [databaseOf(kept)], "only its own database goes");
    assert.equal((await storytree.listProjects()).includes(site), false);
    await assert.rejects(storytree.dropProject(site), /no project/);
  });
});

test("1.12 dropProject waits out a connection to the project it may not end, and deletes the project once that connection has gone", async () => {
  const site = uniqueProjectName();
  await withStorytree([databaseOf(site)], async (storytree) => {
    await storytree.openProject(site);
    let dropped: Promise<unknown> = Promise.resolve();
    // A superuser's connection, as an autovacuum worker's would be: the client's ordinary role may
    // not end it (42501), and it ends by itself moments later.
    await withTestClient(async () => {
      let settled = false;
      dropped = storytree.dropProject(site).then(() => undefined, (error: unknown) => error).finally(() => (settled = true));
      await quietFor(() => settled, 600, "the drop finishing while a connection it may not end is still open");
    }, databaseOf(site));

    assert.equal(await dropped, undefined);
    assert.deepEqual(await databasesContaining(site.slice("t-".length)), []);
  });
});

test("1.12 a project once deleted is not made again by an open that only reaches an existing project: it is refused as gone, and no database appears", async () => {
  const run = uniqueProjectName();
  const site = `${run}-site`;
  await withStorytree([databaseOf(site)], async (storytree) => {
    await (await storytree.openProject(site)).close();
    await (await storytree.openProject(site, { create: false })).close();
    await storytree.dropProject(site);

    await assert.rejects(storytree.openProject(site, { create: false }), (error: unknown) => error instanceof ProjectGoneError && error.project === site);
    assert.deepEqual(await databasesContaining(run.slice("t-".length)), [], "nothing is made again");
  });
});

test("1.12 an open that only reaches an existing project, racing that project's deletion, opens it or is refused as gone", async () => {
  const run = uniqueProjectName();
  const sites = Array.from({ length: 20 }, (_, index) => `${run}-site-${index}`);
  await withStorytree(sites.map(databaseOf), async (storytree) => {
    for (const site of sites) {
      await (await storytree.openProject(site)).close();
      const [opened] = await Promise.allSettled([storytree.openProject(site, { create: false }), storytree.dropProject(site)]);
      if (opened.status === "fulfilled") await opened.value.close();
      else assert.ok(opened.reason instanceof ProjectGoneError && opened.reason.project === site, `refused as gone, not ${String(opened.reason)}`);
    }
  });
});

test("1.12 a connection a caller holds when another computer deletes its project fails its next query, and the process does not crash", async () => {
  const site = `${uniqueProjectName()}-site`;
  await withStorytree([databaseOf(site)], async (storytree) => {
    const project = await storytree.openProject(site);
    const held = await project.pool.connect();
    try {
      const ended = new Promise((resolve) => held.once("end", resolve));
      await dropTestDatabases([databaseOf(site)]);
      // An error the held connection raised with no one listening would fail this test as uncaught before it ends.
      await ended;
      await assert.rejects(held.query("SELECT 1"));
    } finally {
      held.release(true);
      await project.close();
    }
  });
});

test("1.4 a record saved in one project cannot be read from another", async () => {
  const run = uniqueProjectName();
  const site = `${run}-site`;
  const app = `${run}-app`;
  await withStorytree([databaseOf(site), databaseOf(app)], async (storytree) => {
    const siteLibrary = await storytree.openProject(site);
    const appLibrary = await storytree.openProject(app);
    const probe = "SELECT value FROM library_meta WHERE key = 'isolation-probe'";

    await siteLibrary.pool.query("INSERT INTO library_meta (key, value) VALUES ('isolation-probe', 'saved in site')");

    const values = async (project: Project) => (await project.pool.query<{ value: string }>(probe)).rows.map((row) => row.value);
    assert.deepEqual(await values(siteLibrary), ["saved in site"], "site reads its own record");
    assert.deepEqual(await values(appLibrary), [], "app cannot read site's record");
    assert.equal((await metaOf(databaseOf(app)))["isolation-probe"], undefined, "app's database holds only its own records");
    // Each library is its own database, not a view onto a shared one.
    assert.equal(await connectedDatabase(siteLibrary), databaseOf(site));
    assert.equal(await connectedDatabase(appLibrary), databaseOf(app));
  });
});

test("1.5 a bad project name is refused before anything touches the server, and the error names the rule", async () => {
  // Nothing listens on port 1: a name check that ran after reaching for the server would fail
  // with a connection error instead of naming the rule.
  const offline = await connect({ url: "postgres://postgres@127.0.0.1:1/postgres" });
  try {
    const refused = [
      "",
      "Site",
      "my_site",
      "my site",
      "-site",
      "site-",
      "my--site",
      "x".repeat(41),
      "sité",
      "site\n",
      "../site",
      undefined as unknown as string,
    ];
    for (const name of refused) {
      await assert.rejects(
        offline.openProject(name),
        (error: unknown) => {
          assert.ok(error instanceof Error, `the refusal of ${JSON.stringify(name)} is an Error`);
          assert.match(error.message, /lower-case letters, digits and single hyphens/, `for ${JSON.stringify(name)}`);
          assert.match(error.message, /1.40 characters/, `for ${JSON.stringify(name)}`);
          assert.match(error.message, /start(s|ing) with a letter or digit/, `for ${JSON.stringify(name)}`);
          return true;
        },
        `${JSON.stringify(name)} should be refused`,
      );
    }
    // Control: a good name passes the rule (one character is enough) and does reach for the
    // server, which proves the server above really was out of reach.
    await assert.rejects(offline.openProject("a"), { code: "ECONNREFUSED" });
  } finally {
    await offline.close();
  }

  // The rule's far edges open for real: forty characters, and a leading digit.
  const run = uniqueProjectName();
  const longest = `${run}-${"x".repeat(29)}`;
  const digitFirst = `9-${run}`;
  assert.equal(longest.length, 40);
  await withStorytree([databaseOf(longest), databaseOf(digitFirst)], async (storytree) => {
    for (const name of [longest, digitFirst]) {
      assert.equal((await storytree.openProject(name)).name, name);
    }
    assert.deepEqual(await databasesContaining(run), [databaseOf(digitFirst), databaseOf(longest)]);
  });
});

/**
 * A server user that may read a project's tables and nothing more: not their owner, no CREATE on
 * its schema, and no role to take on. It is the shape of an account let only read, or write a
 * little (CI's health account, contract 8.4), rather than set tables up.
 */
async function createReader(role: string, database: string): Promise<void> {
  await createTestRole(role, { createdb: false });
  await withTestClient((client) => client.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`));
  await withTestClient(
    (client) => client.query(`GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT ON library_meta, record, record_event TO "${role}"`),
    database,
  );
}

test("1.10 opening a project whose tables are current runs no table setup, so it needs no owner's rights", async () => {
  const name = uniqueProjectName();
  const reader = `${name}-reader`;
  let opened: Storytree | undefined;
  try {
    await withStorytree([databaseOf(name)], async (storytree) => {
      const owner = await storytree.openProject(name);
      const saved = await owner.transactions.save({ id: "kept", type: "decision", fields: { title: "Kept", text: "Read by anyone let in." } });
      await createReader(reader, databaseOf(name));

      opened = await connect({ url: as(reader) });
      const project = await opened.openProject(name);
      assert.deepEqual(await project.transactions.get("kept"), saved);
    });
  } finally {
    await opened?.close();
    await dropTestRoles([reader]);
  }
});

test("1.11 an account that may not change a project's tables opens it set up, behind, with one warning and no table change; one never set up is refused saying so", async (t) => {
  const name = uniqueProjectName();
  const reader = `${name}-reader`;
  let opened: Storytree | undefined;
  const tables = async (): Promise<string[]> =>
    withTestClient(
      async (client) => (await client.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((row) => row.name),
      databaseOf(name),
    );
  try {
    await withStorytree([databaseOf(name)], async (storytree) => {
      await storytree.openProject(name);
      await createReader(reader, databaseOf(name));
      await withTestClient((client) => client.query(`GRANT INSERT, UPDATE ON library_meta, record, record_event TO "${reader}"; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "${reader}"`), databaseOf(name));
      // As a project made before its latest table was added stands: set up, but not all the way.
      await withTestClient((client) => client.query("DROP TABLE embedding"), databaseOf(name));
      await withTestClient((client) => client.query("DELETE FROM library_meta WHERE key <> 'project'"), databaseOf(name));
      const behind = await tables();

      const warn = t.mock.method(console, "warn", () => undefined);
      opened = await connect({ url: as(reader) });
      const project = await opened.openProject(name);
      await project.close();
      const again = await opened.openProject(name);
      const saved = await again.transactions.save({ id: "kept", type: "decision", fields: { title: "Kept", text: "Written by an account let write." } });
      assert.deepEqual(await again.transactions.get("kept"), saved);
      const warnings = warn.mock.calls.map((call) => String(call.arguments[0])).filter((text) => text.includes(name));
      warn.mock.restore();
      assert.equal(warnings.length, 1, `one warning over two opens, not ${JSON.stringify(warnings)}`);
      assert.ok(warnings[0]!.includes(reader), "it names the account");
      assert.deepEqual(await tables(), behind, "no table was made or changed");
      await opened.close();
      opened = undefined;

      // A project never set up is refused, and nothing is attempted.
      await withTestClient((client) => client.query("DROP TABLE library_meta, record_event, record, feedback_screenshot, history_repair CASCADE"), databaseOf(name));
      opened = await connect({ url: as(reader) });
      await assert.rejects(opened.openProject(name), (error: unknown) => {
        assert.ok(error instanceof ConnectionError, `a ConnectionError, not ${String(error)}`);
        assert.equal(error.problem, "project-owner");
        assert.match(error.message, new RegExp(`"${name}".*set up or upgraded.*owner`, "s"));
        assert.ok(error.message.includes(reader), "it names the account that was refused");
        return true;
      });
      assert.deepEqual(await tables(), [], "no table was made");

      // Its owner still sets it up, as before.
      assert.equal((await storytree.openProject(name)).name, name);
      assert.ok((await tables()).includes("embedding"), "its owner sets the tables up");
    });
  } finally {
    await opened?.close();
    await dropTestRoles([reader]);
  }
});

test("1.15 a project records whether it is the user's factory or a product naming its factory, and refuses to be both (ADR-1040)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    const built = await storytree.openProject(product);
    assert.deepEqual(await made.lineage.factory(), { kind: "none" }, "a new project names no factory");

    assert.equal(await made.lineage.markFactory(), true, "the first mark makes it the factory");
    assert.equal(await made.lineage.markFactory(), false, "a second mark finds it one already");
    await built.lineage.recordFactory(factory);
    assert.deepEqual(await made.lineage.factory(), { kind: "factory" });
    assert.deepEqual(await built.lineage.factory(), { kind: "product", factory });

    // Kept in the project's own library, read again over a fresh connection.
    await built.close();
    assert.deepEqual(await (await storytree.openProject(product)).lineage.factory(), { kind: "product", factory });

    await assert.rejects(made.lineage.recordFactory(product), /is a factory/);
    await assert.rejects((await storytree.openProject(product)).lineage.markFactory(), /product project/);
    await assert.rejects((await storytree.openProject(product)).lineage.recordFactory(product), RangeError);
    assert.deepEqual(await made.lineage.factory(), { kind: "factory" }, "a refused write leaves it as it was");
  });
});

test("1.16 a product project reads its factory's roles, notes and checks, and its own record of the same kind and title wins (ADR-1040)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    await made.lineage.markFactory();
    const principle = (title: string, statement: string) => ({ title, description: `${title}.`, statement, why: "It helps.", howToApply: "Do it." });
    const shared = await made.knowledge.writeKnowledge("principle", principle("Keep it small", "The factory's wording."));
    const edited = await made.knowledge.writeKnowledge("principle", principle("Test first", "The factory's wording."));
    const check = await made.knowledge.writeKnowledge("check", { title: "Proxy assertion", description: "Proxies pass.", question: "Is any assertion a proxy?", enforces: [shared.id] });
    const role = await made.knowledge.writeKnowledge("agent", {
      title: "builder", description: "Builds.", oneLine: "Builds.", role: "Build.", outcome: "Built.", context: [shared.id, edited.id], tools: "All", workflow: "Build it.",
    });
    await made.knowledge.recordDecision({ title: "The factory's own decision", text: "Kept in the factory.", status: "accepted" });

    const before = await storytree.openProject(product);
    await before.lineage.recordFactory(factory);
    const own = await before.knowledge.writeKnowledge("principle", principle("Test first", "The product's own wording."));
    const added = await before.knowledge.writeKnowledge("principle", principle("Name things plainly", "The product's own note."));
    await before.close();

    // A product's library reads its factory from the next opening on.
    const built = await storytree.openProject(product);
    const statements = (await built.records.list("principle")).map((each) => [each.fields.title, each.fields.statement]).sort();
    assert.deepEqual(statements, [
      ["Keep it small", "The factory's wording."],
      ["Name things plainly", "The product's own note."],
      ["Test first", "The product's own wording."],
    ]);
    assert.deepEqual((await built.records.list("agent")).map((each) => each.id), [role.id]);
    assert.deepEqual((await built.records.list("check")).map((each) => each.id), [check.id]);

    // A role's links, written as the factory's ids, read the note the product edited in place of the factory's.
    assert.equal((await built.records.get(shared.id))?.id, shared.id, "a note the product holds no copy of reads as the factory's");
    assert.equal((await built.records.get(edited.id))?.id, own.id, "the product's own note shadows the factory's under its id too");
    assert.equal((await built.records.get(added.id))?.id, added.id);
    assert.deepEqual((await built.knowledge.search("wording")).map((note) => note.id).sort(), [shared.id, own.id].sort());

    // The factory's memory stays its own, and nothing the product wrote reaches the factory.
    assert.deepEqual(await built.records.list("decision"), []);
    assert.deepEqual((await made.records.list("principle")).map((each) => each.fields.statement), ["The factory's wording.", "The factory's wording."]);

    // A product whose factory is gone reads only its own records.
    await made.close();
    await storytree.dropProject(factory);
    const orphan = await storytree.openProject(product);
    assert.deepEqual((await orphan.records.list("principle")).map((each) => each.id).sort(), [own.id, added.id].sort());
    assert.equal(await orphan.records.get(shared.id), null);
  });
});

test("1.17 a product's link to a system record it retired, as moving onto its factory drops a copy, reads the record of that kind and title: its own, else the factory's (ADR-1040)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    await made.lineage.markFactory();
    const principle = (title: string, statement: string) => ({ title, description: `${title}.`, statement, why: "It helps.", howToApply: "Do it." });
    const theirs = await made.knowledge.writeKnowledge("principle", principle("Keep it small", "The factory's wording."));

    const before = await storytree.openProject(product);
    const copy = await before.knowledge.writeKnowledge("principle", principle("Keep it small", "The copy's wording."));
    const decision = await before.knowledge.recordDecision({ title: "A decision", text: "Kept.", status: "accepted" });
    await before.lineage.recordFactory(factory);
    await before.close();

    const built = await storytree.openProject(product);
    await built.records.retire(copy.id, "dropped for the factory's");
    assert.equal(((await built.records.get(copy.id))?.fields as { statement?: string } | undefined)?.statement, "The factory's wording.", "a link to the dropped copy reads the factory's record");
    assert.equal((await built.records.get(copy.id))?.id, theirs.id);

    const edited = await built.knowledge.writeKnowledge("principle", principle("Keep it small", "The product's later wording."));
    assert.equal((await built.records.get(copy.id))?.id, edited.id, "its own record of the title wins over the factory's");

    // Memory the product retired stays retired.
    await built.records.retire(decision.id, "withdrawn");
    assert.equal(await built.records.get(decision.id), null);
  });
});

test("1.16 a change to the factory's system after a product was set up is in the factory's history and reaches the product's next session, the product's own edits still winning (ADR-1040)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    await made.lineage.markFactory();
    const principle = (title: string, statement: string) => ({ title, description: `${title}.`, statement, why: "It helps.", howToApply: "Do it." });
    const dropped = await made.knowledge.writeKnowledge("principle", principle("Keep it small", "The factory's wording."));
    const shadowed = await made.knowledge.writeKnowledge("principle", principle("Test first", "The factory's wording."));
    const role = await made.knowledge.writeKnowledge("agent", {
      title: "builder", description: "Builds.", oneLine: "Builds.", role: "Build.", outcome: "Built.", context: [shadowed.id], tools: "All", workflow: "Build it.",
    });
    const before = await storytree.openProject(product);
    await before.lineage.recordFactory(factory);
    const own = await before.knowledge.writeKnowledge("principle", principle("Test first", "The product's own wording."));
    await before.close();
    const since = Math.max(0, ...(await made.records.history()).map((entry) => entry.seq));

    // The user's agents change the factory's system: a role edited, a check added, a note retired, a shadowed note edited.
    await made.knowledge.editNote(role.id, { workflow: "Build it test-first." });
    const check = await made.knowledge.writeKnowledge("check", { title: "Proxy assertion", description: "Proxies pass.", question: "Is any assertion a proxy?", enforces: [shadowed.id] });
    await made.records.retire(dropped.id, "no longer part of the system");
    await made.knowledge.editNote(shadowed.id, { statement: "The factory's new wording." });

    // The factory's globe draws from its history, which holds each change.
    const changes = (await made.records.history({ since })).map((entry) => [entry.recordId, entry.action]);
    assert.deepEqual(changes, [[role.id, "updated"], [check.id, "created"], [dropped.id, "retired"], [shadowed.id, "updated"]]);

    // The product's next session works with the changed system, and its own note still wins.
    const built = await storytree.openProject(product);
    assert.equal(((await built.records.get(role.id))?.fields as { workflow?: string } | undefined)?.workflow, "Build it test-first.");
    assert.deepEqual((await built.records.list("agent")).map((each) => each.fields.workflow), ["Build it test-first."]);
    assert.deepEqual((await built.records.list("check")).map((each) => each.id), [check.id]);
    assert.deepEqual((await built.records.list("principle")).map((each) => [each.id, each.fields.statement]), [[own.id, "The product's own wording."]]);
    assert.equal(await built.records.get(dropped.id), null, "a retired factory note is gone from the product too");
    assert.equal((await built.records.get(shadowed.id))?.id, own.id);
  });
});

test("1.18 an edit through a product of a system record it reads from its factory writes the product's own copy, which wins, and retiring one hides it from the product; the factory is unchanged (ADR-1040)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    await made.lineage.markFactory();
    const principle = (title: string, statement: string) => ({ title, description: `${title}.`, statement, why: "It helps.", howToApply: "Do it." });
    const edited = await made.knowledge.writeKnowledge("principle", principle("Keep it small", "The factory's wording."));
    const retired = await made.knowledge.writeKnowledge("principle", principle("Test first", "The factory's wording."));
    const shadowed = await made.knowledge.writeKnowledge("principle", principle("Name things plainly", "The factory's wording."));
    const before = await storytree.openProject(product);
    await before.lineage.recordFactory(factory);
    const own = await before.knowledge.writeKnowledge("principle", principle("Name things plainly", "The product's own wording."));
    await before.close();

    const built = await storytree.openProject(product);
    const copy = await built.knowledge.editNote(edited.id, { statement: "The product's edit." });
    assert.equal(copy?.id, edited.id, "the copy keeps the factory's id, so links to it read the edit");
    assert.equal((copy?.fields as { why?: string } | undefined)?.why, "It helps.", "fields the edit leaves are the factory's");
    assert.equal(((await built.records.get(edited.id))?.fields as { statement?: string } | undefined)?.statement, "The product's edit.");
    await built.knowledge.editNote(edited.id, { statement: "The product's second edit." });

    // An edit through the factory's id of a record the product shadows edits the product's own.
    assert.equal((await built.knowledge.editNote(shadowed.id, { statement: "The product's edited wording." }))?.id, own.id);

    await built.records.retire(retired.id, "not part of this product");
    assert.equal(await built.records.get(retired.id), null, "a retired inherited record reads as gone");
    assert.deepEqual((await built.records.list("principle")).map((each) => [each.id, each.fields.statement]).sort(), [
      [edited.id, "The product's second edit."],
      [own.id, "The product's edited wording."],
    ].sort());

    // The factory is unchanged, and the product's next session reads the same.
    assert.deepEqual((await made.records.list("principle")).map((each) => each.fields.statement), ["The factory's wording.", "The factory's wording.", "The factory's wording."]);
    await made.knowledge.editNote(retired.id, { statement: "The factory's later wording." });
    await built.close();
    const again = await storytree.openProject(product);
    assert.equal(await again.records.get(retired.id), null, "a factory edit does not bring back what the product retired");
    assert.deepEqual((await again.records.list("principle")).map((each) => each.id).sort(), [edited.id, own.id].sort());

    // Retiring through the factory's id a record the product shadows retires its own as well.
    await again.records.retire(shadowed.id, "not part of this product");
    assert.equal(await again.records.get(shadowed.id), null);
    assert.equal(await again.records.get(own.id), null);
    assert.deepEqual((await again.records.list("principle")).map((each) => each.id), [edited.id]);
  });
});

test("1.19 a product's inherited records are the factory's system records it reads and holds no record of its own for: its copies, shadows, retirements and the factory's memory left out (ADR-1040)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    await made.lineage.markFactory();
    const principle = (title: string, statement: string) => ({ title, description: `${title}.`, statement, why: "It helps.", howToApply: "Do it." });
    const read = await made.knowledge.writeKnowledge("principle", principle("Keep it small", "The factory's wording."));
    const shadowed = await made.knowledge.writeKnowledge("principle", principle("Name things plainly", "The factory's wording."));
    const edited = await made.knowledge.writeKnowledge("principle", principle("Test first", "The factory's wording."));
    const retired = await made.knowledge.writeKnowledge("principle", principle("Ship daily", "The factory's wording."));
    const check = await made.knowledge.writeKnowledge("check", { title: "Proxy assertion", description: "Proxies pass.", question: "Is any assertion a proxy?", enforces: [read.id] });
    await made.knowledge.recordDecision({ title: "The factory's decision", text: "Kept.", status: "accepted" });

    const before = await storytree.openProject(product);
    await before.lineage.recordFactory(factory);
    await before.knowledge.writeKnowledge("principle", principle("Name things plainly", "The product's own wording."));
    await before.close();
    const built = await storytree.openProject(product);
    await built.knowledge.editNote(edited.id, { statement: "The product's edit." });
    await built.records.retire(retired.id, "not part of this product");

    const inherited = async () => (await (built.records as InheritedRecords).inherited()).map((each) => each.id);
    assert.deepEqual(await inherited(), [read.id, check.id].sort());
    assert.ok(!(await inherited()).includes(shadowed.id), "the factory's record a product's own of that title shadows is not inherited");

    // It reads the factory as it is now.
    await made.knowledge.editNote(read.id, { statement: "The factory's new wording." });
    const [now] = (await (built.records as InheritedRecords).inherited()).filter((each) => each.id === read.id);
    assert.equal((now?.fields as { statement?: string } | undefined)?.statement, "The factory's new wording.");
  });
});

test("1.21 a project opened with system switches leaves each switched-off role, check and note out of its lists, selections and searches, a record's own title or id beating its group and a group beating all, while reading one by id still finds it and the plan stays whole (ADR-1092 D2)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    await made.lineage.markFactory();
    const principle = (title: string, statement: string) => ({ title, description: `${title}.`, statement, why: "It helps.", howToApply: "Do it." });
    const small = await made.knowledge.writeKnowledge("principle", principle("Keep it small", "The factory's wording."));
    await made.knowledge.writeKnowledge("principle", principle("Test first", "The factory's wording."));
    const check = await made.knowledge.writeKnowledge("check", { title: "Proxy assertion", description: "Proxies pass.", question: "Is any assertion a proxy?", enforces: [small.id] });
    const role = await made.knowledge.writeKnowledge("agent", {
      title: "builder", description: "Builds.", oneLine: "Builds.", role: "Build.", outcome: "Built.", context: [small.id], tools: "All", workflow: "Build it.",
    });
    await made.close();

    const before = await storytree.openProject(product);
    await before.lineage.recordFactory(factory);
    const own = await before.knowledge.writeKnowledge("principle", principle("Test first", "The product's own wording."));
    const plain = await before.knowledge.writeKnowledge("principle", principle("Name things plainly", "The product's own wording."));
    const story = await before.work.addStory({ title: "Play the game" });
    await before.close();

    const opened = (off: readonly string[], on: readonly string[] = []) => storytree.openProject(product, { system: { off, on } });
    const titles = async (project: Project, kind: "principle" | "agent" | "check") => (await project.records.list(kind)).map((each) => each.fields.title).sort();

    const bare = await opened(["all"]);
    for (const kind of ["principle", "agent", "check"] as const) assert.deepEqual(await titles(bare, kind), [], kind);
    assert.deepEqual(await bare.records.select("principle", ["statement"]), []);
    assert.deepEqual(await bare.knowledge.search("wording"), []);
    assert.equal((await bare.records.get(role.id))?.id, role.id, "a record switched off is still read by its id, as a link to it is followed");
    assert.deepEqual((await bare.records.list("story")).map((each) => each.id), [story.id], "the plan is never switched off");
    await bare.close();

    const some = await opened(["all"], ["notes", "builder"]);
    assert.deepEqual(await titles(some, "agent"), ["builder"], "a record's own title switched on beats all off");
    assert.deepEqual(await titles(some, "check"), []);
    assert.deepEqual(await titles(some, "principle"), ["Keep it small", "Name things plainly", "Test first"], "a group switched on beats all off");
    await some.close();

    const one = await opened(["notes", check.id], ["Test first"]);
    const shown = await one.records.list("principle");
    assert.deepEqual(shown.map((each) => [each.id, each.fields.statement]), [[own.id, "The product's own wording."]], "the product's own record is the one switched on, never the factory's it shadows");
    assert.deepEqual(await titles(one, "check"), [], "a record switched off by its id");
    assert.deepEqual(await titles(one, "agent"), ["builder"]);
    await one.close();

    const limited = await opened(["Keep it small"]);
    const first = await limited.records.list("principle", { limit: 1 });
    assert.deepEqual(first.map((each) => each.id), [[own.id, plain.id].sort()[0]], "a limit counts only what is shown");
    assert.deepEqual((await limited.records.select("principle", ["statement"], { limit: 5 })).map((each) => each.id).sort(), [own.id, plain.id].sort());
    assert.deepEqual(Object.keys((await limited.records.select("principle", ["statement"]))[0]!.fields), ["statement"], "a selection keeps only the fields asked for");
    await limited.close();
  });
});

test("1.26 a project opened with a plugin's kinds writes and reads them, its system switches and its factory beside; opened without them, a record of that kind reads dormant, as stored, in no list, and a write of it is refused (ADR-1178 D3)", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  const note = { kind: "voice.note", version: 1, fields: { type: "object", properties: { words: { type: "string" } }, required: ["words"] }, writers: ["storytree_voice"] };
  const voice = "voice.note" as RecordType; // a plugin's kind is no core RecordType
  await withStorytree([databaseOf(factory), databaseOf(product)], async (storytree) => {
    const made = await storytree.openProject(factory);
    await made.lineage.markFactory();
    await made.close();
    const before = await storytree.openProject(product);
    await before.lineage.recordFactory(factory);
    await before.close();

    const mounted = await storytree.openProject(product, { kinds: [note], system: { off: ["roles"], on: [] } });
    const written = await mounted.records.create(voice, { words: "park the globe idea" } as FieldsOf<RecordType>);
    assert.deepEqual(written.fields, { words: "park the globe idea" });
    const read = await mounted.records.get(written.id);
    assert.deepEqual([read?.fields, read?.dormant], [{ words: "park the globe idea" }, undefined], "read back live, not dormant");
    assert.deepEqual((await mounted.records.list(voice)).map((each) => each.id), [written.id]);
    await assert.rejects(mounted.records.create(voice, { said: "no words" } as FieldsOf<RecordType>), { name: "SchemaError" }, "fields outside the declared shape are refused");
    await mounted.close();

    const unmounted = await storytree.openProject(product);
    const stored = await unmounted.records.get(written.id);
    assert.deepEqual([stored?.fields, stored?.dormant], [{ words: "park the globe idea" }, true], "without the plugin it reads as stored, marked dormant");
    assert.deepEqual(await unmounted.records.list(voice), [], "and is in no list");
    await assert.rejects(unmounted.records.create(voice, { words: "another" } as FieldsOf<RecordType>), { name: "UnknownTypeError" });
    await unmounted.close();
  });
});

test("1.28 · a change to the history goes only through the logged repair switch, for the owner too, and the owner's ordinary writes pass when row-level security is forced", async () => {
  const name = uniqueProjectName();
  const owner = `${name}-owner`;
  const database = databaseOf(name);
  const asOwner = <T>(fn: (client: Client) => Promise<T>) => withTestClientAs(owner, fn, database);
  let opened: Storytree | undefined;
  try {
    await createTestRole(owner, { createdb: true });
    opened = await connect({ url: as(owner) });
    const project = await opened.openProject(name);
    await project.transactions.save({ id: "kept", type: "decision", fields: { title: "Kept", text: "Before row security." } });
    // As the library host's grants leave it: row-level security on, and forced, so the owner meets the policies too.
    await withTestClient((client) => client.query(
      "ALTER TABLE record ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY; ALTER TABLE record_event ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY",
    ), database);

    await project.transactions.save({ id: "later", type: "decision", fields: { title: "Later", text: "After." } });
    await project.transactions.edit({ id: "kept", fields: { text: "Edited under forced row security." } });
    await project.transactions.retire({ id: "later", reason: "done with it" });
    assert.deepEqual((await project.transactions.list("decision")).map((record) => [record.id, record.fields.text]), [["kept", "Edited under forced row security."]]);
    assert.equal((await project.transactions.history()).length, 4, "the owner reads and adds history");

    const entries = () => withTestClient(async (client) => (await client.query<{ actor: string | null }>("SELECT actor FROM record_event ORDER BY seq")).rows.map((row) => row.actor), database);
    const before = await entries();
    for (const change of ["UPDATE record_event SET actor = 'rewritten'", "DELETE FROM record_event", "TRUNCATE record_event"]) {
      await assert.rejects(asOwner((client) => client.query(change)), /append-only/, `the owner: ${change}`);
      await assert.rejects(withTestClient((client) => client.query(change), database), /append-only/, `a superuser: ${change}`);
    }
    assert.deepEqual(await entries(), before, "nothing in the history changed");

    await assert.rejects(asOwner((client) => client.query("SELECT record_event_repair('')")), /reason/, "the switch needs a reason");
    const repaired = await asOwner(async (client) => {
      await client.query("BEGIN");
      await client.query("SELECT record_event_repair('contract 13.5: a number the import got wrong')");
      const { rowCount } = await client.query("UPDATE record_event SET actor = 'repaired' WHERE record_id = 'kept' AND action = 'created'");
      await client.query("COMMIT");
      return rowCount;
    });
    assert.equal(repaired, 1, "through the switch, the owner's repair reaches the entry");
    await assert.rejects(asOwner((client) => client.query("DELETE FROM record_event")), /append-only/, "the switch lasted only for its transaction");

    const log = await withTestClient(async (client) => (await client.query<{ operation: string; reason: string; recorded_by: string; recorded_at: Date; now: Date }>(
      "SELECT operation, reason, recorded_by, recorded_at, now() AS now FROM history_repair ORDER BY seq",
    )).rows, database);
    assert.deepEqual(log.map((row) => [row.operation, row.reason, row.recorded_by]), [["UPDATE", "contract 13.5: a number the import got wrong", owner]], "the use is recorded");
    assert.ok(Math.abs(log[0]!.recorded_at.getTime() - log[0]!.now.getTime()) < 60_000, `with the server's time, not ${String(log[0]!.recorded_at)}`);
    await assert.rejects(asOwner((client) => client.query("DELETE FROM history_repair")), /append-only/, "and its record stays");
  } finally {
    await opened?.close();
    await dropTestDatabases([database]);
    await dropTestRoles([owner]);
  }
});

test("1.22 each history entry carries the server's own time and the account that wrote it, whatever the writer sends, and no writer may change or remove an entry", async () => {
  const name = uniqueProjectName();
  const writer = `${name}-writer`;
  const database = databaseOf(name);
  const history = (where: string) =>
    withTestClient(async (client) => (await client.query<{ actor: string | null; at: Date; recorded_by: string | null; recorded_at: Date | null; now: Date }>(
      `SELECT actor, at, recorded_by, recorded_at, now() AS now FROM record_event WHERE ${where} ORDER BY seq`,
    )).rows, database);
  try {
    await withStorytree([database], async (storytree) => {
      const project = await storytree.openProject(name);
      // An entry written before the project had these columns keeps them empty, rather than the upgrade's time and account.
      await withTestClient((client) => client.query(
        `DROP TRIGGER record_event_recorded ON record_event; DROP TRIGGER record_event_append_only ON record_event;
         ALTER TABLE record_event DROP COLUMN recorded_at, DROP COLUMN recorded_by; DELETE FROM library_meta WHERE key = 'schema';
         INSERT INTO record_event (record_id, type, action, record) VALUES ('older', 'decision', 'created', '{}')`,
      ), database);
      await project.close();
      await storytree.openProject(name);
      assert.deepEqual((await history("record_id = 'older'")).map((row) => [row.recorded_by, row.recorded_at]), [[null, null]]);

      await createReader(writer, database);
      await withTestClient((client) => client.query(`GRANT INSERT, UPDATE, DELETE, TRUNCATE ON record_event TO "${writer}"; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "${writer}"`), database);
      await withTestClientAs(writer, (client) => client.query(
        `INSERT INTO record_event (record_id, type, action, record, actor, at, recorded_by, recorded_at)
         VALUES ('sent', 'decision', 'created', '{}', 'someone else', '2000-01-01T00:00:00Z', 'someone else', '2000-01-01T00:00:00Z')`,
      ), database);
      const [sent] = await history("record_id = 'sent'");
      assert.equal(sent!.actor, "someone else", "the writer's own account of who is kept");
      assert.equal(sent!.at.toISOString(), "2000-01-01T00:00:00.000Z", "and of when");
      assert.equal(sent!.recorded_by, writer, "beside the account the server saw");
      assert.ok(sent!.recorded_at !== null && Math.abs(sent!.recorded_at.getTime() - sent!.now.getTime()) < 60_000, `and the server's time, not ${String(sent!.recorded_at)}`);

      for (const change of ["UPDATE record_event SET actor = 'rewritten'", "DELETE FROM record_event", "TRUNCATE record_event"]) {
        await assert.rejects(withTestClientAs(writer, (client) => client.query(change), database), /append-only/, change);
      }
      assert.deepEqual((await history("true")).map((row) => row.actor), [null, "someone else"], "every entry is still there, unchanged");

      await assert.rejects(withTestClient((client) => client.query("DELETE FROM record_event WHERE record_id = 'older'"), database), /append-only/, "nor may the owner");
      assert.deepEqual((await history("true")).map((row) => row.actor), [null, "someone else"], "the owner removed nothing");
    });
  } finally {
    await dropTestRoles([writer]);
  }
});
