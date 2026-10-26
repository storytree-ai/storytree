// `pnpm library:restore <snapshot.json> [--project <name>]` (packages/dev-loop/src/restore-library.mjs): the
// snapshot path is read whether or not --project is given, and the snapshot goes into the library
// the `library` setting names. Run as a child process: with a snapshot that does not exist, so it
// fails at reading the file, before any database is reached; and with a home whose setting names
// the Postgres `pnpm test` provides by its address, in a project of its own dropped afterwards.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";
import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** The script's exit, stdout and stderr, run with `args` in a throwaway home holding `settings`. */
async function restore(args, { settings, env = {} } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "restore-args-"));
  try {
    if (settings !== undefined) writeFileSync(path.join(home, "settings.json"), JSON.stringify(settings));
    const run = spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/restore-library.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, STORYTREE_HOME: home, ...env },
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    await removeTemp(home);
  }
}

test("5.3 a snapshot path alone is read as the snapshot, not answered with the usage line", async () => {
  const missing = path.join(tmpdir(), "no-such-snapshot-4f1c.json");
  const run = await restore([missing]);
  assert.equal(run.status, 1);
  assert.doesNotMatch(run.stderr, /usage:/);
  assert.match(run.stderr, /no-such-snapshot-4f1c\.json/);
});

test("5.3 a snapshot path before or after --project is read as the snapshot", async () => {
  const missing = path.join(tmpdir(), "no-such-snapshot-4f1c.json");
  for (const args of [[missing, "--project", "p"], ["--project", "p", missing]]) {
    const run = await restore(args);
    assert.doesNotMatch(run.stderr, /usage:/, args.join(" "));
    assert.match(run.stderr, /no-such-snapshot-4f1c\.json/, args.join(" "));
  }
});

test("5.3 no snapshot path is answered with the usage line", async () => {
  assert.match((await restore([])).stderr, /usage:/);
  assert.match((await restore(["--project", "p"])).stderr, /usage:/);
});

test("5.10 a snapshot is restored into the library the setting names by its address, which the run names", { timeout: 60_000 }, async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const [from, into] = [`t-${randomBytes(4).toString("hex")}`, `t-${randomBytes(4).toString("hex")}`];
  t.after(() => dropTestDatabases([`storytree_${from}`, `storytree_${into}`]));
  const storytree = await connect({ url });
  let snapshot;
  try {
    const library = await storytree.openProject(from);
    try {
      await library.addStory({ title: "The kettle", description: "The kettle boils water." });
    } finally {
      await library.close();
    }
    snapshot = await storytree.snapshot(from);
  } finally {
    await storytree.close();
  }
  const dir = mkdtempSync(path.join(tmpdir(), "restore-snapshot-"));
  t.after(() => removeTemp(dir));
  const file = path.join(dir, "snapshot.json");
  writeFileSync(file, JSON.stringify(snapshot));

  // An address carries no password: the run takes it from PGPASSWORD, as the postgres key.
  const address = new URL(url);
  const password = decodeURIComponent(address.password);
  address.password = "";
  const run = await restore([file, "--project", into], { settings: { library: { location: "postgres", address: address.href } }, env: { PGPASSWORD: password } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(`the library at ${address.href}`), run.stdout);

  const after = await connect({ url });
  try {
    assert.ok((await after.listProjects()).includes(into), "the project is in the library the setting names");
    const restored = await after.openProject(into);
    try {
      assert.deepEqual((await restored.projectTree()).stories.map((story) => story.title), ["The kettle"]);
    } finally {
      await restored.close();
    }
  } finally {
    await after.close();
  }
});
