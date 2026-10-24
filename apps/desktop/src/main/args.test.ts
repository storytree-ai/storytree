import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.js";

test("smoke can capture either globe mode, while ordinary launches keep the Forest default", () => {
  assert.equal(parseArgs([]).forestMode, undefined);
  assert.equal(parseArgs(["--smoke", "--forest-mode", "library"]).forestMode, "library");
  assert.equal(parseArgs(["--smoke", "--forest-mode=forest"]).forestMode, "forest");
  assert.throws(() => parseArgs(["--smoke", "--forest-mode", "flat"]), /forest.*library/);
});

test("1.30 · `--stress <rounds>` asks the smoke check for that many stress rounds, none unless asked", () => {
  assert.equal(parseArgs(["--smoke"]).stress, 0);
  assert.equal(parseArgs(["--smoke", "--stress", "3"]).stress, 3);
  assert.equal(parseArgs(["--smoke", "--stress=2"]).stress, 2);
  assert.throws(() => parseArgs(["--smoke", "--stress", "many"]), /--stress/);
});
