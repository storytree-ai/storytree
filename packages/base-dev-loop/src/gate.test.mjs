// ADR-1170 D1, D2: the base dev loop's gate runs the project's typecheck and tests, then every step a part
// contributes, in one PASS / FAIL / NOT RUN table, and an interrupted gate never reports a pass.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp, waitUntil } from "@storytree/test-waits";

import { contributedHold, runGate } from "./gate.mjs";

const command = () => ({ command: process.execPath, args: [], shell: false });
// Two contributed steps from one part, with nothing switched off.
const composition = { parts: [{ name: "check:lint", command }, { name: "check:spelling", command }], owners: ["linter", "linter"], graph: { linter: [] } };
// No factory plugin named for a part, whatever this computer's own settings name.
const noStandIns = () => ({ folder: undefined, plugins: {} });
const gate = (options) => runGate({ steps: async () => composition, partsOff: () => [], standIns: noStandIns, ...options });

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
  const code = await runGate({ root, steps: async () => composition, partsOff: () => ["speller"], standIns: noStandIns, log: (line) => output.push(line), run: async (step) => (calls.push(step), step === "check:lint" ? 1 : 0) });
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

test("1.4 a factory plugin's gate steps run where this computer names it, in its part's place or as a part it adds, and one that cannot be loaded is NOT RUN with why", async (t) => {
  const root = project(t);
  const factory = project(t);
  const plugin = (name, body) => {
    const dir = path.join(factory, "plugins", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, storytree: { interface: 1, gateSteps: [{ from: "./steps", export: "gateSteps" }] }, exports: { "./steps": "./steps.cjs" } }));
    if (body) writeFileSync(path.join(dir, "steps.cjs"), body);
  };
  const step = (name) => `exports.gateSteps = [{ name: ${JSON.stringify(name)}, command: () => ({ command: process.execPath, args: [], shell: false }) }];`;
  plugin("my-speller", step("check:my-spelling"));
  plugin("my-extra", step("check:my-extra"));
  plugin("my-broken");
  const run = (standIns, partsOff) => {
    const calls = [];
    const output = [];
    return runGate({ root, steps: async () => composition, partsOff: () => partsOff, standIns: () => ({ folder: factory, plugins: standIns }), log: (line) => output.push(line), run: async (name) => (calls.push(name), 0) })
      .then((code) => ({ code, calls, table: output.at(-1) }));
  };

  const inPlace = await run({ linter: "my-speller", extra: "my-extra" }, ["linter", "extra"]);
  assert.deepEqual(inPlace.calls, ["typecheck", "test", "check:my-spelling", "check:my-extra"]);
  assert.equal(inPlace.code, 0);
  assert.match(inPlace.table, /NOT RUN\s+check:lint — linter is switched off on this computer/);

  const partOn = await run({ linter: "my-speller" }, []);
  assert.deepEqual(partOn.calls, ["typecheck", "test", "check:lint", "check:spelling"]);
  assert.doesNotMatch(partOn.table, /my-spelling/);

  const broken = await run({ extra: "my-broken" }, ["extra"]);
  assert.deepEqual(broken.calls, ["typecheck", "test", "check:lint", "check:spelling"]);
  assert.match(broken.table, /NOT RUN\s+my-broken — its stand-in my-broken could not be loaded/);
});

test("1.5 a run takes every run hold placed on this computer, in order, and its release lets them go in reverse; a switched-off part's, or a plugin that cannot be loaded, holds nothing", async (t) => {
  const root = project(t);
  const factory = project(t);
  const log = path.join(factory, "events");
  const events = () => readFileSync(log, "utf8").trim().split("\n");
  // Each hold records its take and its release in one file, the plugin's from its own process-loaded module.
  const hold = (name) => ({ name, take: async ({ what }) => (appendFileSync(log, `take ${name} for ${what}\n`), () => appendFileSync(log, `release ${name}\n`)) });
  const composition = { parts: [hold("base lock"), hold("quiet lock")], owners: ["locker", "quiet"], graph: { locker: [], quiet: [] } };
  const plugin = (name, body) => {
    const dir = path.join(factory, "plugins", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, storytree: { interface: 1, runHolds: [{ from: "./holds", export: "runHolds" }] }, exports: { "./holds": "./holds.cjs" } }));
    if (body) writeFileSync(path.join(dir, "holds.cjs"), body);
  };
  plugin("my-lock", `const { appendFileSync } = require("node:fs"); const log = ${JSON.stringify(log)};
exports.runHolds = [{ name: "my lock", take: async ({ what }) => (appendFileSync(log, "take my lock for " + what + "\\n"), () => appendFileSync(log, "release my lock\\n")) }];`);
  plugin("my-broken");
  const said = [];
  const take = contributedHold({ root, compose: async () => composition, partsOff: () => ["quiet", "extra", "broken"], standIns: () => ({ folder: factory, plugins: { extra: "my-lock", broken: "my-broken" } }), log: (line) => said.push(line) });

  const release = await take({ root, what: "pnpm test" });
  assert.deepEqual(events(), ["take base lock for pnpm test", "take my lock for pnpm test"], "the switched-off part's hold is not taken; the plugin's is, after the parts'");
  assert.match(said.join("\n"), /my-broken holds nothing: its stand-in my-broken could not be loaded/);
  release();
  release();
  assert.deepEqual(events().slice(2), ["release my lock", "release base lock"], "released once each, in reverse");

  writeFileSync(log, "");
  const none = await contributedHold({ root, compose: async () => composition, partsOff: () => ["locker", "quiet"], standIns: noStandIns, log: () => {} })({ root, what: "pnpm gate" });
  none();
  assert.equal(readFileSync(log, "utf8"), "", "with every part switched off and no plugin named, nothing is taken");
});
