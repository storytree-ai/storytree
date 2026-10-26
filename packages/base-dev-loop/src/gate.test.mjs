// ADR-1170 D1, D2: the base dev loop's gate runs the project's typecheck and tests, then every step a part
// contributes, in one PASS / FAIL / NOT RUN table, and an interrupted gate never reports a pass.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp, waitUntil } from "@storytree/test-waits";

import { runGate } from "./gate.mjs";

const command = () => ({ command: process.execPath, args: [], shell: false });
// Two contributed steps from one part, with nothing switched off.
const composition = { parts: [{ name: "check:lint", command }, { name: "check:spelling", command }], owners: ["linter", "linter"], graph: { linter: [] } };
const gate = (options) => runGate({ steps: async () => composition, partsOff: () => [], ...options });

function project(t) {
  const root = mkdtempSync(path.join(tmpdir(), "gate-"));
  t.after(() => removeTemp(root));
  return root;
}

test("1.1 the gate runs its base steps, then each step a part contributes: a failing one turns it red, and a switched-off part's is NOT RUN with why", async (t) => {
  const root = project(t);
  const composition = {
    parts: [{ name: "check:lint", command }, { name: "check:spelling", command }, { name: "check:quiet", when: () => ({ run: false, reason: "nothing to read" }), command }],
    owners: ["linter", "speller", "linter"],
    graph: { linter: [], speller: [] },
  };
  const calls = [];
  const output = [];
  const code = await runGate({ root, steps: async () => composition, partsOff: () => ["speller"], log: (line) => output.push(line), run: async (step) => (calls.push(step), step === "check:lint" ? 1 : 0) });
  assert.deepEqual(calls, ["typecheck", "test", "check:lint"]);
  assert.equal(code, 1);
  const table = output.at(-1);
  assert.match(table, /FAIL\s+check:lint — exit 1/);
  assert.match(table, /NOT RUN\s+check:spelling — speller is switched off on this computer/);
  assert.match(table, /NOT RUN\s+check:quiet — nothing to read/);
});

test("1.2 interruption leaves the current and remaining checks NOT RUN and exits nonzero", async (t) => {
  const root = project(t);
  const controller = new AbortController();
  const output = [];
  const calls = [];
  const code = await gate({ root, signal: controller.signal, log: (line) => output.push(line), run: async (step) => {
    calls.push(step);
    controller.abort();
    return 0;
  } });
  assert.equal(code, 130);
  assert.deepEqual(calls, ["typecheck"]);
  assert.match(output.at(-1), /NOT RUN\s+typecheck.*interrupted/);
  assert.match(output.at(-1), /NOT RUN\s+test.*interrupted/);
  assert.match(output.at(-1), /NOT RUN\s+check:lint.*interrupted/);
});

test("1.2 cancelling the foreground gate stops the typecheck process and its compiler descendant", { timeout: 60_000 }, async (t) => {
  const root = project(t);
  const write = (file, text) => writeFileSync(path.join(root, file), text);
  // A package manager starting a compiler, as pnpm typecheck does. Use real processes here:
  // a callback-only cancellation test cannot detect an abandoned compiler.
  write("manager.mjs", `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    writeFileSync('manager.pid', String(process.pid));
    spawn(process.execPath, ['compiler.mjs'], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `);
  write("compiler.mjs", `
    import { writeFileSync } from 'node:fs';
    writeFileSync('compiler.pid', String(process.pid));
    setInterval(() => {}, 1000);
  `);
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = path.join(root, "manager.mjs");
  const controller = new AbortController();
  const pids = [];
  t.after(() => {
    controller.abort();
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
  });
  const running = gate({ root, signal: controller.signal, log: () => {} });
  // A pid file can exist before its pid is written, and an empty one reads as pid 0, which
  // process.kill takes as this process (Windows) or its group (Unix): wait for a real pid.
  const pidIn = (file) => existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
  for (const file of ["manager.pid", "compiler.pid"].map((name) => path.join(root, name))) {
    pids.push(await waitUntil(() => pidIn(file) > 0 && pidIn(file), 10_000, `a real pid in ${path.basename(file)}`));
  }
  controller.abort();
  assert.equal(await running, 130);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await waitUntil(() => !pids.some(alive), 10_000, `the typecheck children (${pids.join(", ")}) to exit after the gate completed`);
});
