// Capability 6 · Repeating a change's new tests
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { changeNewTests, repeatTests } from "./repeat-new-tests.mjs";

function repository(t, files) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "repeat-new-")));
  t.after(() => removeTemp(dir));
  const git = (...args) => {
    const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  };
  git("init", "-q");
  write(dir, files);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return { dir, git };
}

function write(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    if (text === null) rmSync(path.join(dir, file));
    else writeFileSync(path.join(dir, file), text);
  }
}

test("6.1 · the tests a change adds are its numbered tests whose titles open on added lines, less one reworded in its file, moved or renumbered, or written in a string", (t) => {
  const { dir, git } = repository(t, {
    "a.test.mjs": `import { test } from "node:test";\ntest("1.1 · old", () => { kept(); });\ntest("1.3 · reworded", () => { before(); });\n`,
    "b.test.mjs": `import { test } from "node:test";\ntest("2.1 · moving", () => {\n  movingBody();\n});\ntest("2.2 · moving twin", () => {\n  movingBody();\n});\n`,
    "src/c.mjs": `export const c = 1;\n`,
  });
  write(dir, {
    "a.test.mjs": `import { test } from "node:test";\ntest("1.1 · old", () => { kept(); changed(); });\ntest("1.2 · new", () => { added(); });\n`
      + `const fixture = 'test("1.9 · in a string", () => {})';\ntest("helper, not numbered", () => {});\n`
      + `test("1.3 · reworded", () => { after(); });\n`,
    "b.test.mjs": null,
    "c.test.mjs": `import { test } from "node:test";\ntest("3.1 · moved", () => {\n  movingBody();\n});\ntest("3.2 · also new", () => {});\n`
      + `test("3.3 · moved twin", () => {\n  movingBody();\n});\ntest("3.4 · new, with a moved test's body", () => {\n  movingBody();\n});\n`
      + `test("3.5 · it\\u2019s \\"escaped\\"", () => {});\n`
      + `const reading = (line) => /^His voice session's reading$/.test(line);\ntest("3.6 · below a regex holding a quote", () => { reading('x'); });\n`,
    "src/c.mjs": `export const c = 2;\ntest("4.1 · not a test file", () => {});\n`,
  });
  git("add", "-A");
  git("commit", "-q", "-m", "change");
  write(dir, { "d.test.mjs": `import { test } from "node:test";\ntest("5.1 · uncommitted", () => {});\n` });
  git("add", "d.test.mjs");

  assert.deepEqual(changeNewTests(dir).map(({ file, test }) => `${file} › ${test}`).sort(),
    ["a.test.mjs › 1.2 · new", "c.test.mjs › 3.2 · also new", "c.test.mjs › 3.4 · new, with a moved test's body",
      "c.test.mjs › 3.5 · it\u2019s \"escaped\"", "c.test.mjs › 3.6 · below a regex holding a quote", "d.test.mjs › 5.1 · uncommitted"]);
});

test("6.2 · each new test runs five times through the test entry, old tests never; a failure among the repeats fails the run naming it flaky, and no new test runs nothing", (t) => {
  const { dir, git } = repository(t, { "a.test.mjs": `import { test } from "node:test";\ntest("1.1 · old", () => { throw new Error("an old test ran"); });\n` });
  writeFileSync(path.join(dir, "entry.mjs"), `import { appendFileSync, mkdirSync } from "node:fs";
import { run } from "node:test";
const args = process.argv.slice(2);
const pattern = args.find((arg) => arg.startsWith("--test-name-pattern="));
const stream = run({ files: args.filter((arg) => !arg.startsWith("--")), testNamePatterns: pattern ? [new RegExp(pattern.slice(20))] : undefined });
mkdirSync(".pgtest", { recursive: true });
for await (const event of stream) {
  if (event.type === "test:fail" && event.data.details.type !== "suite") {
    process.exitCode = 1;
    appendFileSync(".pgtest/red-runs.jsonl", JSON.stringify({ file: "a.test.mjs", test: event.data.name }) + "\\n");
  }
}
`);
  const lines = [];
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const repeat = () => repeatTests({ root: dir, tests: changeNewTests(dir), entry: [path.join(dir, "entry.mjs")], env, print: (line) => lines.push(line) });

  assert.equal(repeat(), 0);
  assert.match(lines.join("\n"), /adds no numbered test, so nothing repeats/);

  writeFileSync(path.join(dir, "a.test.mjs"), `import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
test("1.1 · old", () => { throw new Error("an old test ran"); });
test("1.2 · new (flaky)", () => {
  let runs = 0;
  try { runs = Number(readFileSync("runs.txt", "utf8")); } catch {}
  writeFileSync("runs.txt", String(runs + 1));
  if (runs + 1 === 2) throw new Error("fails on its second run");
});
`);
  git("add", "a.test.mjs");
  lines.length = 0;
  assert.equal(repeat(), 1, lines.join("\n"));
  assert.equal(readFileSync(path.join(dir, "runs.txt"), "utf8"), "5");
  assert.deepEqual(lines.filter((line) => line.startsWith("flaky:")),
    ["flaky: a.test.mjs › 1.2 · new (flaky) failed 1 of 5 repeats. A new test that does not pass every time is weak: investigate it (ADR-1352), never file it as friction."]);
  assert.ok(!readFileSync(path.join(dir, ".pgtest", "red-runs.jsonl"), "utf8").includes("1.1 · old"));

  writeFileSync(path.join(dir, "dies.mjs"), "process.exit(1);\n");
  lines.length = 0;
  assert.equal(repeatTests({ root: dir, tests: changeNewTests(dir), times: 2, entry: [path.join(dir, "dies.mjs")], env, print: (line) => lines.push(line) }), 1);
  assert.deepEqual(lines.filter((line) => line.startsWith("flaky:")),
    ["flaky: a.test.mjs failed 2 of 2 repeats. A new test that does not pass every time is weak: investigate it (ADR-1352), never file it as friction."]);
});
