// How the repository's plan-reading checks open storytree's library (library-reach.mjs): the library the user's
// library setting names, refused with its way out when it holds no project storytree.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { removeTemp } from "@storytree/test-waits";

import { withLibrary } from "./library-reach.mjs";

test("4.4 · a plan-reading check run against a library holding no storytree project says so, naming the restore command, and reads nothing; one holding it is read", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const home = mkdtempSync(path.join(tmpdir(), "library-reach-"));
  t.after(() => removeTemp(home));
  // The setting names the server without its password, which reaches it as PGPASSWORD, as CI's run gives it.
  const address = new URL(url);
  const password = decodeURIComponent(address.password);
  address.password = "";
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ library: { location: "postgres", address: address.href } }));
  for (const [name, value] of [["STORYTREE_HOME", home], ["PGPASSWORD", password]]) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => (before === undefined ? delete process.env[name] : (process.env[name] = before)));
  }
  const said = [];
  t.mock.method(console, "error", (line) => said.push(line));

  // Its own project name, since other tests share the server: absent, then made.
  const project = `t-${randomBytes(4).toString("hex")}`;
  let read = false;
  const result = await withLibrary(async () => (read = true), "pnpm check", project);
  assert.equal(result, undefined);
  assert.equal(read, false, "an empty library is not read as an empty plan");
  assert.match(said.join("\n"), new RegExp(`no project "${project}".*pnpm library:restore`));

  const owner = await connect({ url });
  t.after(() => dropTestDatabases([`storytree_${project}`]));
  await (await owner.openProject(project)).close();
  await owner.close();
  assert.equal(await withLibrary(async (library) => typeof library.projectTree, "pnpm check", project), "function", "the named library is read");
});
