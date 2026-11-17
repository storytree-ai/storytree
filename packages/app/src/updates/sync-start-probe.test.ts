// TEMPORARY probe for increment_4fd4bcacb977 (draft PR only, never landed): on Windows, is a test that blocks synchronously
// before its first await read by the harness's exit watch as a file that ended and sat idle? And does one turn of the
// event loop before each test stop that?
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const harness = ["..", "..", "..", "base-dev-loop", "src", "unit-run.mjs"].join("/");

const body = (yieldFirst: boolean) => `import test, { beforeEach } from "node:test";
import { execFileSync } from "node:child_process";
${yieldFirst ? "beforeEach(() => new Promise(resolve => setImmediate(resolve)));" : ""}
test("first", async () => { await new Promise(r => setTimeout(r, 50)); });
test("second blocks synchronously before its first await", async () => {
  execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 28000)"]);
  await Promise.resolve();
});
test("third", () => {});
`;

for (const yieldFirst of [false, true]) {
  test(`4.23 probe: a test blocking synchronously first, ${yieldFirst ? "with" : "without"} a yield before each test`, { timeout: 120_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "sync-start-"));
    const file = join(root, "block.test.mjs");
    writeFileSync(file, body(yieldFirst));
    const { runUnit } = await import(new URL(harness, import.meta.url).href) as { runUnit: (o: object) => Promise<any> };
    void pathToFileURL;
    const r = await runUnit({ root, files: [file], env: process.env, unitLimitMs: 100_000, hold: true });
    console.log(`probe ${yieldFirst ? "with" : "without"} yield: ${JSON.stringify({ code: r.code, exitHung: r.exitHung, ms: r.ms, tests: r.tests.map((t: { name: string }) => t.name) })}`);
    assert.ok(true);
  });
}
