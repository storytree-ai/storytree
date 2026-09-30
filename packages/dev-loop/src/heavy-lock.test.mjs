// increment_d8c91507b3a1 / increment_8610446d96b6: heavy runs on one machine queue behind a named
// lock in STORYTREE_HOME, taken by the test harness itself, instead of saturating the machine.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function machine(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "heavy-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const log = path.join(dir, "runs.log");
  const file = path.join(dir, "slow.test.mjs");
  writeFileSync(
    file,
    `import { test } from "node:test"; import { appendFileSync } from "node:fs";
test("slow", async () => {
  appendFileSync(${JSON.stringify(log)}, \`start \${process.env.RUN} \${Date.now()}\\n\`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  appendFileSync(${JSON.stringify(log)}, \`end \${process.env.RUN} \${Date.now()}\\n\`);
});`,
  );
  const env = { ...process.env, STORYTREE_HOME: home, STORYTREE_TEST_PG_URL: "postgres://unused" };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  const harness = (run) => {
    const child = spawn(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", file], { cwd: root, env: { ...env, RUN: run }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const done = new Promise((resolve) => child.once("close", (code) => resolve({ code, output })));
    return { child, done };
  };
  const events = () =>
    existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map((line) => {
          const [what, run, at] = line.split(" ");
          return { what, run, at: Number(at) };
        })
      : [];
  return { home, harness, events };
}

test("6.2 a second test run on the machine waits for the first, naming who holds the lock", async (t) => {
  const { harness, events } = machine(t);
  const first = harness("first");
  while (!events().some((event) => event.what === "start")) await delay(50);
  const second = harness("second");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.output);
  assert.equal(b.code, 0, b.output);
  const at = (what, run) => events().find((event) => event.what === what && event.run === run).at;
  assert.ok(at("start", "second") >= at("end", "first"), `the runs overlapped: ${JSON.stringify(events())}`);
  assert.match(b.output, new RegExp(`waiting for .*pid ${first.child.pid}`));
});

test("6.2 a lock whose holder has gone does not block the next run", async (t) => {
  const { home, harness } = machine(t);
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "heavy-run.lock"), JSON.stringify({ id: "old", pid: gone, branch: "gone-branch", since: new Date().toISOString() }));
  const run = await harness("only").done;
  assert.equal(run.code, 0, run.output);
  assert.match(run.output, /gone-branch.*gone/);
  assert.equal(existsSync(path.join(home, "heavy-run.lock")), false, "the lock is released on exit");
});
