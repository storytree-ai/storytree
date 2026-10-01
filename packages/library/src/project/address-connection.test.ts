/**
 * Capability 15 · Connection by address (the library story, ADR-0846 D1): a library at any Postgres
 * address, its password the `postgres` key (ADR-0843). Run on the test server with a role that must
 * give its password: the server trusts every other local connection, so the test puts one
 * scram-sha-256 line for members of a password group at the top of its pg_hba.conf.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { saveKey } from "@storytree/keys";
import pg from "pg";
import { connect, ConnectionError, type Storytree } from "@storytree/library";

import { dropTestDatabases, dropTestRoles, testServerUrl, uniqueProjectName, withTestClient } from "../testing/pg.js";

/** The group whose members must give a password to the test server. */
const PASSWORD_GROUP = "storytree_password_auth";
const PASSWORD_LINE = `host all +${PASSWORD_GROUP} all scram-sha-256`;

/** A login role, member of PASSWORD_GROUP, that the test server lets in only with `password`. */
async function createPasswordRole(name: string, password: string): Promise<void> {
  const file = await withTestClient(async (client) => {
    await client.query(`DO $$ BEGIN CREATE ROLE ${PASSWORD_GROUP} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query(`CREATE ROLE "${name}" LOGIN CREATEDB PASSWORD '${password}' IN ROLE ${PASSWORD_GROUP}`);
    return (await client.query<{ hba_file: string }>("SHOW hba_file")).rows[0]!.hba_file;
  });
  const rules = readFileSync(file, "utf8");
  if (!rules.split(/\r?\n/).includes(PASSWORD_LINE)) {
    writeFileSync(file, `${PASSWORD_LINE}\n${rules}`);
    await withTestClient((client) => client.query("SELECT pg_reload_conf()"));
  }
  // The reload is a signal: wait until the server asks the role for its password.
  for (const until = Date.now() + 10_000; ;) {
    // A wrong password, so a server that asks refuses it outright, leaving no backend waiting on us.
    const wrong = new URL(address(name));
    wrong.password = "not-the-password";
    const probe = new pg.Client({ connectionString: wrong.href });
    const asked = await probe.connect().then(() => false, (error: unknown) => (error as { code?: unknown }).code === "28P01");
    await probe.end().catch(() => {});
    if (asked) return;
    if (Date.now() > until) throw new Error(`the test server did not take up ${PASSWORD_LINE}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function address(user: string, port?: number): string {
  const url = new URL(testServerUrl());
  url.username = user;
  url.password = "";
  if (port !== undefined) url.port = String(port);
  return url.href;
}

/**
 * A throwaway storytree home whose auth.json the library's keys are read from, with no PGPASSWORD:
 * this file's own process, so nothing else sees it.
 */
function home(): string {
  const made = mkdtempSync(path.join(tmpdir(), "storytree-address-"));
  process.env.STORYTREE_HOME = made;
  delete process.env.PGPASSWORD;
  return made;
}

/** A port on this machine nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("15.1 a library at a Postgres address, its password the postgres key, opens, writes and reads a project", async () => {
  const run = uniqueProjectName();
  const [role, project, keys] = [`${run}-pw`, `${run}-address`, home()];
  let storytree: Storytree | undefined;
  try {
    await createPasswordRole(role, "right-secret");
    saveKey("postgres", "right-secret", { home: keys });
    storytree = await connect({ address: address(role) });
    const library = await storytree.openProject(project);
    await library.addStory({ title: "Reached by address", description: "Its password a key." });
    assert.deepEqual((await library.projectTree()).stories.map((story) => story.title), ["Reached by address"]);
  } finally {
    await storytree?.close();
    await dropTestDatabases([`storytree_${project}`]);
    await dropTestRoles([role]);
    rmSync(keys, { recursive: true, force: true });
  }
});

test("15.2 with no password saved for the library, connecting is refused saying how to save one, before reaching the server", async () => {
  const keys = home();
  try {
    await assert.rejects(
      connect({ address: address("someone", await closedPort()) }),
      (error: unknown) => {
        assert.ok(error instanceof ConnectionError, String(error));
        assert.equal(error.problem, "no-password");
        assert.match(error.message, /no password saved for this library/i);
        assert.match(error.message, /storytree auth set postgres/);
        return true;
      },
    );
  } finally {
    rmSync(keys, { recursive: true, force: true });
  }
});

test("15.3 a refused password and an unreachable host are each their own refusal, never showing the password", async () => {
  const run = uniqueProjectName();
  const [role, keys] = [`${run}-pw`, home()];
  const opened: Storytree[] = [];
  try {
    await createPasswordRole(role, "right-secret");
    saveKey("postgres", "wrong-secret", { home: keys });
    const refused = await connect({ address: address(role) });
    opened.push(refused);
    await assert.rejects(refused.listProjects(), (error: unknown) => {
      assert.ok(error instanceof ConnectionError, String(error));
      assert.equal(error.problem, "password");
      assert.ok(!error.message.includes("wrong-secret"), error.message);
      assert.match(error.message, /storytree auth set postgres/);
      return true;
    });

    const away = await connect({ address: address(role, await closedPort()) });
    opened.push(away);
    await assert.rejects(away.listProjects(), (error: unknown) => {
      assert.ok(error instanceof ConnectionError, String(error));
      assert.equal(error.problem, "unreachable");
      assert.ok(!error.message.includes("wrong-secret"), error.message);
      return true;
    });
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestRoles([role]);
    rmSync(keys, { recursive: true, force: true });
  }
});
