import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.js";

test("smoke can capture either globe mode, while ordinary launches keep the Forest default", () => {
  assert.equal(parseArgs([]).forestMode, undefined);
  assert.equal(parseArgs(["--smoke", "--forest-mode", "library"]).forestMode, "library");
  assert.equal(parseArgs(["--smoke", "--forest-mode=forest"]).forestMode, "forest");
  assert.throws(() => parseArgs(["--smoke", "--forest-mode", "flat"]), /forest.*library/);
});
