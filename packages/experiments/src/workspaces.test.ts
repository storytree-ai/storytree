/**
 * Capability 2 · Arm workspaces, on the real Postgres `pnpm test` provides, its superuser the cluster's admin. A stand-in
 * for the real project is a test database of its own, with a row no arm may touch.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { resolveKey } from "@storytree/keys";
import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { readExperiment, readLibrary } from "@storytree/project-and-caller";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import pg from "pg";

import { armWorkspace, dropArm, grantArm, makeArm } from "./workspaces.js";
import { testAdminUrl, withAdmin } from "./testing/pg.js";

/** A fresh experiment's name: `t-` and 8 hex digits, so every database it names is a test database. */
function freshExperiment(): string {
  return `t-${Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, "0")}`;
}

/**
 * Run `body` as the cluster's admin, beside a stand-in for the real project's database holding one row; every arm of the
 * experiment and the stand-in are dropped after, pass or fail.
 */
async function onCluster(body: (admin: pg.Client, server: string, real: string, experiment: string) => Promise<void>): Promise<void> {
  const experiment = freshExperiment();
  const real = `storytree_${experiment}-real`;
  await withAdmin((client) => client.query(`CREATE DATABASE "${real}"`));
  await withAdmin(async (client) => {
    await client.query("CREATE TABLE points (merge int, passed int)");
    await client.query("INSERT INTO points VALUES (1, 7)");
  }, real);
  const server = new URL(testAdminUrl());
  server.password = "";
  try {
    await withAdmin((admin) => body(admin, server.href, real, experiment));
  } finally {
    const arms = ["map-reads-on", "map-reads-off"].map((arm) => armWorkspace(experiment, arm, "unused"));
    await dropTestDatabases([...arms.map((arm) => arm.database), real]);
    await withAdmin(async (client) => { for (const { role } of arms) await client.query(`DROP ROLE IF EXISTS "${role}"`); });
  }
}

async function realRows(real: string): Promise<unknown[]> {
  return withAdmin(async (client) => (await client.query("SELECT merge, passed FROM points")).rows, real);
}

test("2.1 · making an arm gives it a role and a database named for it and a home pointing there, whose key opens the arm's own project, and never touches the real project", async () => {
  await onCluster(async (admin, server, real, experiment) => {
    await withTempDir(async (folder) => {
      const home = path.join(folder, "arm");
      const made = await makeArm(admin, server, experiment, "map-reads-off", home);
      assert.equal(made.role, `x-${experiment}-map-reads-off`);
      assert.equal(made.project, made.role);
      assert.equal(made.database, `storytree_${made.role}`);

      assert.deepEqual(readExperiment(home), { name: experiment, arm: "map-reads-off" });
      const library = readLibrary(home);
      assert.equal(library.location, "postgres");
      const address = new URL(library.location === "postgres" ? library.address : "");
      assert.equal(address.username, made.role);
      assert.equal(address.pathname, `/${made.database}`);

      const signedIn = new URL(address.href);
      signedIn.password = resolveKey("postgres", { home, env: {} })!;
      const storytree = await connect({ url: signedIn.href });
      try {
        await storytree.openProject(made.project);
      } finally {
        await storytree.close();
      }
      // The arm's own library was set up in its database, by its role.
      const owners = await withAdmin(async (client) => (await client.query<{ owner: string }>("SELECT DISTINCT tableowner AS owner FROM pg_tables WHERE schemaname = 'public'")).rows, made.database);
      assert.deepEqual(owners, [{ owner: made.role }]);
      // The arm's role reaches nothing of the real project's.
      const into = new URL(signedIn.href);
      into.pathname = `/${real}`;
      const intruder = new pg.Client({ connectionString: into.href });
      await intruder.connect();
      try {
        await assert.rejects(intruder.query("SELECT * FROM points"), /permission denied/);
      } finally {
        await intruder.end();
      }
      assert.deepEqual(await realRows(real), [{ merge: 1, passed: 7 }]);

      await assert.rejects(makeArm(admin, server, experiment, "map-reads-off", path.join(folder, "again")), /already made.*drop it first/);
      assert.equal(existsSync(path.join(folder, "again")), false);
    });
  });
});

test("2.2 · dropping an arm drops its database, role and home, and leaves the real library's records and every other arm as they were", async () => {
  await onCluster(async (admin, server, real, experiment) => {
    await withTempDir(async (folder) => {
      const off = await makeArm(admin, server, experiment, "map-reads-off", path.join(folder, "off"));
      const on = await makeArm(admin, server, experiment, "map-reads-on", path.join(folder, "on"));

      await dropArm(admin, experiment, "map-reads-off", off.home);

      const left = await withAdmin(async (client) => ({
        databases: (await client.query<{ name: string }>("SELECT datname AS name FROM pg_database WHERE datname LIKE $1 ORDER BY 1", [`%${experiment}%`])).rows.map((row) => row.name),
        roles: (await client.query<{ name: string }>("SELECT rolname AS name FROM pg_roles WHERE rolname LIKE $1 ORDER BY 1", [`x-${experiment}%`])).rows.map((row) => row.name),
      }));
      assert.deepEqual(left, { databases: [on.database, real].sort(), roles: [on.role] });
      assert.equal(existsSync(off.home), false);
      assert.deepEqual(readExperiment(on.home), { name: experiment, arm: "map-reads-on" });
      assert.deepEqual(await realRows(real), [{ merge: 1, passed: 7 }]);

      await dropArm(admin, experiment, "map-reads-off", off.home);
    });
  });
});

test("2.3 · an experiment or arm name that is not lower-case words and hyphens, or one too long, is refused before anything is made; a home naming another arm is never removed", async () => {
  assert.equal(armWorkspace("twin-build", "reviewer-off", "home").role, "x-twin-build-reviewer-off", "any arm an experiment names, none held in code");
  assert.throws(() => armWorkspace("twin-build", "Map_Reads", "home"), /arm's name.*lower-case.*Map_Reads/);
  assert.throws(() => armWorkspace("Twin_Build", "map-reads-off", "home"), /lower-case/);
  assert.throws(() => armWorkspace("a-very-long-experiment-name-indeed", "map-reads-off", "home"), /40 characters/);
  await onCluster(async (admin, server, _real, experiment) => {
    await withTempDir(async (folder) => {
      const on = await makeArm(admin, server, experiment, "map-reads-on", path.join(folder, "on"));
      await assert.rejects(dropArm(admin, experiment, "map-reads-off", on.home), /not the home of arm "map-reads-off"/);
      assert.deepEqual(readExperiment(on.home), { name: experiment, arm: "map-reads-on" });
    });
  });
});

/** Stand-ins for the server's shared own databases, named for `experiment`: two a lane adds to, two it only reads. */
function standIns(experiment: string) {
  return [
    { database: `${experiment}-activity`, write: true },
    { database: `${experiment}-quality`, write: true },
    { database: `${experiment}-trunks`, write: false },
    { database: `${experiment}-experiments`, write: false },
  ] as const;
}

async function signedInAs(made: { home: string; address: string }, database: string): Promise<pg.Client> {
  const url = new URL(made.address);
  url.password = resolveKey("postgres", { home: made.home, env: {} })!;
  url.pathname = `/${encodeURIComponent(database)}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  return client;
}

test("2.5 · An arm's role reads and adds to the server's shared activity and QA databases and reads its routing and points, never deleting there; granted by make, again by grant, revoked by drop", async () => {
  await onCluster(async (admin, server, _real, experiment) => {
    const shared = standIns(experiment);
    for (const { database } of shared) {
      await withAdmin((client) => client.query(`CREATE DATABASE "${database}"`));
      await withAdmin(async (client) => {
        await client.query("CREATE TABLE storytree_setup (digest text PRIMARY KEY)");
        await client.query("CREATE TABLE lines (seq bigserial PRIMARY KEY, project text, answer text)");
        await client.query("INSERT INTO lines (project) VALUES ('storytree')");
      }, database);
    }
    const absent = `${experiment}-absent`;
    const options = { onDatabase: <T>(database: string, body: (one: pg.Client) => Promise<T>) => withAdmin(body, database), shared: [...shared, { database: absent, write: true }] };
    try {
      await withTempDir(async (folder) => {
        const made = await makeArm(admin, server, experiment, "map-reads-on", path.join(folder, "on"), options);
        assert.deepEqual(made.granted, shared.map((one) => one.database), "a shared database the server lacks is skipped");

        const lane = async () => {
          for (const { database, write } of shared) {
            const client = await signedInAs(made, database);
            try {
              await client.query("SELECT digest FROM storytree_setup");
              assert.equal((await client.query<{ project: string }>("SELECT project FROM lines ORDER BY seq")).rows[0]!.project, "storytree");
              if (write) {
                await client.query("INSERT INTO lines (project) VALUES ($1)", [made.project]);
                await client.query("UPDATE lines SET answer = 'fixed' WHERE project = $1", [made.project]);
              } else {
                await assert.rejects(client.query("INSERT INTO lines (project) VALUES ($1)", [made.project]), /permission denied/);
              }
              await assert.rejects(client.query("DELETE FROM lines"), /permission denied/);
              await assert.rejects(client.query("INSERT INTO storytree_setup VALUES ('forged')"), /permission denied/);
            } finally {
              await client.end();
            }
          }
        };
        await lane();

        // A table the server sets up after the arm was made is the lane's too.
        await withAdmin((client) => client.query("CREATE TABLE later (project text)"), shared[0].database);
        const later = await signedInAs(made, shared[0].database);
        try {
          await later.query("INSERT INTO later VALUES ($1)", [made.project]);
        } finally {
          await later.end();
        }

        // An arm made before make granted anything is granted the same by grant, and granting again changes nothing.
        for (const { database } of shared) await withAdmin((client) => client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${made.role}"`), database);
        await assert.rejects(lane(), /permission denied/);
        await grantArm(admin, experiment, "map-reads-on", options);
        await grantArm(admin, experiment, "map-reads-on", options);
        await lane();

        await dropArm(admin, experiment, "map-reads-on", made.home, options);
        const roles = await withAdmin(async (client) => (await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [made.role])).rows);
        assert.deepEqual(roles, []);
        const kept = await withAdmin(async (client) => (await client.query<{ project: string }>("SELECT project FROM lines ORDER BY seq")).rows.map((row) => row.project), shared[0].database);
        assert.deepEqual(kept, ["storytree", made.project, made.project], "the shared lines, the lane's two included, stay when the arm is dropped");
      });
    } finally {
      await dropTestDatabases(shared.map((one) => one.database));
    }
  });
});
