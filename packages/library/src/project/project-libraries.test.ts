/**
 * Capability 1 · Project libraries: one test per contract in the library story.
 *
 * These run against the real Postgres that `pnpm test` provides. Every project a test makes is
 * named with uniqueProjectName() and its databases are dropped at the end, pass or fail, so tests
 * can share one server, and run beside other test files, without seeing each other's projects.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createTestRole, dropTestDatabases, dropTestRoles, testRoleUrl as as, testServerUrl, uniqueProjectName, withTestClient } from "../testing/pg.js";
import { ConnectionError, ProjectGoneError, connect, type Project, type Storytree } from "./index.js";

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

test("1.1 openProject creates the project's database and its tables", async () => {
  const name = uniqueProjectName();
  await withStorytree([databaseOf(name)], async (storytree) => {
    assert.deepEqual(await databasesContaining(name), [], "precondition: the project has no database yet");

    const project = await storytree.openProject(name);

    assert.equal(project.name, name);
    assert.deepEqual(await databasesContaining(name), [databaseOf(name)], "its database is storytree_<name>");
    // Its tables exist, seen from outside the library: library_meta, holding the project's name.
    assert.equal((await metaOf(databaseOf(name))).project, name);
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
          const deadline = Date.now() + 5_000;
          for (;;) {
            await blocker.query("SELECT pg_stat_clear_snapshot()");
            const { rows } = await blocker.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))", [pid],
            );
            if (rows.length > 0) break;
            assert.ok(Date.now() < deadline, "the project opening reaches the held schema read");
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
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
        const { rows } = await observer.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1", [databaseOf(name)],
        );
        assert.equal(rows[0]?.n, 0, "no project connection is left on Postgres");
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
          const deadline = Date.now() + 5000;
          for (;;) {
            const { rows } = await project.pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))",
              [pid],
            );
            if (rows.length > 0) break;
            assert.ok(Date.now() < deadline, "the second open reaches the in-flight write");
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
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
      dropped = storytree.dropProject(site).then(() => undefined, (error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 600));
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

test("1.11 opening a project whose tables are not current, as an account that may not set them up, is refused saying so", async () => {
  const name = uniqueProjectName();
  const reader = `${name}-reader`;
  let opened: Storytree | undefined;
  try {
    await withStorytree([databaseOf(name)], async (storytree) => {
      await storytree.openProject(name);
      await createReader(reader, databaseOf(name));
      // As a project made before its latest table was added stands: set up, but not all the way.
      await withTestClient((client) => client.query("DROP TABLE embedding"), databaseOf(name));
      await withTestClient((client) => client.query("DELETE FROM library_meta WHERE key <> 'project'"), databaseOf(name));

      opened = await connect({ url: as(reader) });
      await assert.rejects(opened.openProject(name), (error: unknown) => {
        assert.ok(error instanceof ConnectionError, `a ConnectionError, not ${String(error)}`);
        assert.equal(error.problem, "project-owner");
        assert.match(error.message, new RegExp(`"${name}".*set up or upgraded.*owner`, "s"));
        assert.ok(error.message.includes(reader), "it names the account that was refused");
        return true;
      });

      // Its owner still sets it up, as before.
      const again = await storytree.openProject(name);
      assert.equal(again.name, name);
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
    assert.equal((await built.records.get(role.id))?.fields.workflow, "Build it test-first.");
    assert.deepEqual((await built.records.list("agent")).map((each) => each.fields.workflow), ["Build it test-first."]);
    assert.deepEqual((await built.records.list("check")).map((each) => each.id), [check.id]);
    assert.deepEqual((await built.records.list("principle")).map((each) => [each.id, each.fields.statement]), [[own.id, "The product's own wording."]]);
    assert.equal(await built.records.get(dropped.id), null, "a retired factory note is gone from the product too");
    assert.equal((await built.records.get(shadowed.id))?.id, own.id);
  });
});
