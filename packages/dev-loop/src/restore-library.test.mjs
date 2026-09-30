// `pnpm library:restore <snapshot.json> [--project <name>]` (packages/dev-loop/src/restore-library.mjs): the
// snapshot path is read whether or not --project is given. Run as a child process with a snapshot
// that does not exist, so it fails at reading the file, before any database is started.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** The script's exit and stderr, run with `args` in a throwaway home. */
function restore(args) {
  const home = mkdtempSync(path.join(tmpdir(), "restore-args-"));
  try {
    const run = spawnSync(process.execPath, ["--import", "tsx", "packages/dev-loop/src/restore-library.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, STORYTREE_HOME: home },
    });
    return { status: run.status, stderr: run.stderr };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("a snapshot path alone is read as the snapshot, not answered with the usage line", () => {
  const missing = path.join(tmpdir(), "no-such-snapshot-4f1c.json");
  const run = restore([missing]);
  assert.equal(run.status, 1);
  assert.doesNotMatch(run.stderr, /usage:/);
  assert.match(run.stderr, /no-such-snapshot-4f1c\.json/);
});

test("a snapshot path before or after --project is read as the snapshot", () => {
  const missing = path.join(tmpdir(), "no-such-snapshot-4f1c.json");
  for (const args of [[missing, "--project", "p"], ["--project", "p", missing]]) {
    const run = restore(args);
    assert.doesNotMatch(run.stderr, /usage:/, args.join(" "));
    assert.match(run.stderr, /no-such-snapshot-4f1c\.json/, args.join(" "));
  }
});

test("no snapshot path is answered with the usage line", () => {
  assert.match(restore([]).stderr, /usage:/);
  assert.match(restore(["--project", "p"]).stderr, /usage:/);
});
