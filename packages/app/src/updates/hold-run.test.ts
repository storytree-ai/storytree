import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const wrapper = fileURLToPath(new URL("./hold-run.mjs", import.meta.url));

test("4.12 the run wrapper holds before the command starts, preserves its exit code and releases after a failed run", async t => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-hold-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const snapshot = path.join(home, "seen.json");
  const child = `
    const fs = require('node:fs'), path = require('node:path');
    const holds = path.join(process.argv[1], 'update-holds');
    const files = fs.readdirSync(holds);
    if (files.length !== 1) process.exit(9);
    fs.writeFileSync(process.argv[2], fs.readFileSync(path.join(holds, files[0])));
    process.exit(7);
  `;
  const run = spawnSync(process.execPath, [wrapper, home, "Codex trial", "60", process.execPath, "-e", child, home, snapshot], { encoding: "utf8" });
  assert.equal(run.status, 7, run.stderr);
  const seen = JSON.parse(await readFile(snapshot, "utf8"));
  assert.equal(seen.run, "Codex trial");
  assert.equal(seen.expiresAt - seen.startedAt, 60 * 60_000);
  assert.deepEqual(await readdir(path.join(home, "update-holds")), []);
});

test("4.12 a run cannot request an indefinite hold or start its command with an invalid ceiling", async t => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-hold-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const minutes of ["0", "NaN", "Infinity", "361"]) {
    const run = spawnSync(process.execPath, [wrapper, home, "trial", minutes, process.execPath, "-e", "process.exit(9)"], { encoding: "utf8" });
    assert.equal(run.status, 2, run.stderr);
    assert.deepEqual(await readdir(home), []);
  }
});
