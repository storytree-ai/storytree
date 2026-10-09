// increment_36281861bfe6: the tests connect with one url and make roles in their setup with
// another, the superuser's, so that one day they can connect as the ordinary role.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const root = fileURLToPath(new URL("../../..", import.meta.url));

async function superuser(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0].rolsuper;
  } finally {
    await client.end();
  }
}

/** The urls a run of test.mjs hands a test file, given this environment. */
function handed(t, env) {
  const dir = mkdtempSync(path.join(tmpdir(), "test-postgres-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "urls.test.mjs");
  writeFileSync(file, `import { test } from "node:test";
test("urls", () => console.log("URLS " + JSON.stringify([process.env.STORYTREE_TEST_PG_URL, process.env.STORYTREE_TEST_PG_ADMIN_URL])));`);
  const run = { ...process.env, ...env, STORYTREE_HOME: path.join(dir, "home") };
  delete run.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  if (env.STORYTREE_TEST_PG_ADMIN_URL === undefined) delete run.STORYTREE_TEST_PG_ADMIN_URL;
  const out = spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", file], { cwd: root, env: run, encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  return JSON.parse(/URLS (.*)/.exec(out.stdout)[1]);
}

test("6.9 the tests are handed the superuser's url for their setup, beside the url they connect with", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  const admin = process.env.STORYTREE_TEST_PG_ADMIN_URL;
  assert.ok(url, "run these tests through `pnpm test`");
  assert.ok(admin, "`pnpm test` hands the tests STORYTREE_TEST_PG_ADMIN_URL");
  assert.equal(new URL(admin).port, new URL(url).port, "both sign in to the same server");
  assert.equal(await superuser(admin), true, "the admin url can make roles");
});

test("6.9 a run given a server's url hands that url for setup too, unless it is given an admin url as well", (t) => {
  assert.deepEqual(handed(t, { STORYTREE_TEST_PG_URL: "postgres://client@127.0.0.1:1/postgres" }),
    ["postgres://client@127.0.0.1:1/postgres", "postgres://client@127.0.0.1:1/postgres"]);
  assert.deepEqual(handed(t, { STORYTREE_TEST_PG_URL: "postgres://client@127.0.0.1:1/postgres", STORYTREE_TEST_PG_ADMIN_URL: "postgres://admin@127.0.0.1:1/postgres" }),
    ["postgres://client@127.0.0.1:1/postgres", "postgres://admin@127.0.0.1:1/postgres"]);
});
