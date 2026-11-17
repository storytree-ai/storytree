/** Property checks 3.1 and 3.2: the nightly tier's fresh seeds, and the nightly run that finds every check. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { DEFAULT_SEEDS, fc, findCheckFiles, propertyCheck, runNightly } from "./index.js";

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "property-checks-"));
  t.after(() => removeTemp(dir));
  return dir;
}

const why = { judged: "the nightly tier looks wider than the quick tier" };
const NIGHTLY = { STORYTREE_PROPERTY_TIER: "nightly" };

test("3.1 · the nightly tier runs a check on a fresh seed with many more cases than the quick tier", async (t) => {
  const generated = async (env: Record<string, string>) => {
    const seen: number[] = [];
    const property = fc.property(fc.integer(), (n) => {
      seen.push(n);
      return true;
    });
    await propertyCheck(t, { why }, property, { env, tallyPath: path.join(tempDir(t), "tally") });
    return seen;
  };

  const quick = await generated({});
  const nightly = await generated(NIGHTLY);
  const again = await generated(NIGHTLY);
  assert.ok(nightly.length >= 10 * quick.length, `many more cases: ${nightly.length} nightly against ${quick.length} quick`);
  assert.notDeepEqual(nightly.slice(0, 10), quick.slice(0, 10), "not the quick tier's first seed");
  assert.notDeepEqual(again.slice(0, 10), nightly.slice(0, 10), "a fresh seed each run");
});

test("3.1 · the nightly tier stops at its time limit without failing for it", async (t) => {
  let cases = 0;
  const slow = fc.asyncProperty(fc.integer(), async () => {
    cases++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return true;
  });
  await propertyCheck(t, { why }, slow, { env: NIGHTLY, timeLimitMs: 150, tallyPath: path.join(tempDir(t), "tally") });
  assert.ok(cases >= 1 && cases < 100, `stopped at 150 ms after ${cases} cases of 10 ms`);
});

test("3.1 · a nightly failure says it was found on a fresh seed and to pin that seed into the check's seeds", async (t) => {
  const failing = fc.property(fc.integer({ min: 0, max: 1_000_000 }), (n) => n <= 1000);
  await assert.rejects(async () => propertyCheck(t, { why }, failing, { env: NIGHTLY, tallyPath: path.join(tempDir(t), "tally") }), (error: Error) => {
    const replay = /STORYTREE_PROPERTY_SEED=(-?\d+) STORYTREE_PROPERTY_PATH=(\S+)/.exec(error.message);
    assert.ok(replay, `the replay line is in the failure:\n${error.message}`);
    const seed = Number(replay[1]);
    assert.equal(DEFAULT_SEEDS.includes(seed), false, "a fresh seed, not a default one");
    assert.match(error.message, /found on a fresh seed/);
    assert.match(error.message, new RegExp(`pin ${seed} into .*seeds`));
    return true;
  });
});

test("3.2 · the nightly run lists every test file importing property checks and runs them as one pnpm test unit in the nightly tier", async (t) => {
  const root = tempDir(t);
  const imports = `import { propertyCheck } from "${["@storytree", "property-checks"].join("/")}";\n`;
  const files: Record<string, string> = {
    "packages/a/src/sum.test.ts": imports,
    "packages/a/src/plain.test.ts": `import { test } from "node:test";\n`,
    "packages/a/src/helper.ts": imports,
    "packages/b/src/parse.test.mjs": imports,
    "packages/b/node_modules/dep/src/dep.test.ts": imports,
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  const found = ["packages/a/src/sum.test.ts", "packages/b/src/parse.test.mjs"];
  assert.deepEqual(findCheckFiles(root), found);

  const calls: { command: string; args: string[]; env: Record<string, string | undefined> }[] = [];
  const code = await runNightly({
    root,
    run: (command, args, env) => {
      calls.push({ command, args, env });
      return 3;
    },
    log: () => {},
  });
  assert.equal(code, 3, "the unit's exit is the run's");
  assert.equal(calls.length, 1, "one unit");
  const { command, args, env } = calls[0]!;
  assert.equal(command, "pnpm");
  assert.ok(args.includes("test"), `pnpm test: ${args.join(" ")}`);
  assert.deepEqual(args.slice(-found.length), found);
  assert.equal(env.STORYTREE_PROPERTY_TIER, "nightly");
  const limit = Number(env.STORYTREE_UNIT_LIMIT_MS);
  assert.ok(limit >= 9 * 60_000 && limit <= 11 * 60_000, `about ten minutes: ${limit} ms`);
});

test("3.2 · with no test file holding a check the nightly run says so and passes", async (t) => {
  const root = tempDir(t);
  mkdirSync(path.join(root, "packages/a/src"), { recursive: true });
  writeFileSync(path.join(root, "packages/a/src/plain.test.ts"), `import { test } from "node:test";\n`);
  const said: string[] = [];
  let ran = false;
  const code = await runNightly({
    root,
    run: () => {
      ran = true;
      return 1;
    },
    log: (line) => said.push(line),
  });
  assert.equal(code, 0);
  assert.equal(ran, false, "nothing to run");
  assert.match(said.join("\n"), /no property checks/i);
});
