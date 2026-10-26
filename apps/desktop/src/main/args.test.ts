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

test("1.39 · a start carrying a sign-in link takes no flag from it, and reading stops at '--'", () => {
  const linked = parseArgs(["electron", ".", "--quit", "--smoke", "--project", "x", "storytree-auth://callback?code=a&state=b"]);
  assert.deepEqual(linked, parseArgs([]));
  assert.equal(parseArgs(["electron", "STORYTREE-AUTH://callback", "--background"]).background, false);
  assert.equal(parseArgs(["electron", "--background", "--", "--quit"]).quit, false);
  assert.equal(parseArgs(["electron", "--background", "--", "--quit"]).background, true);
});

test("1.39 · an installed build takes its developer and check flags only under CI", () => {
  const dev = ["--smoke", "--screenshot", "shot.png", "--stress", "2", "--start-check", "--callback-check", "--forest-mode", "library", "--project", "p", "--background"];
  const installed = parseArgs(dev, { packaged: true, env: {} });
  assert.deepEqual(installed, { ...parseArgs([]), project: "p", background: true });
  assert.deepEqual(parseArgs(dev, { packaged: true, env: { CI: "true" } }), parseArgs(dev));
  assert.equal(parseArgs(["--start-check"], { packaged: false, env: {} }).startCheck, true);
});

test("1.39 · --screenshot refuses a network or device path", () => {
  for (const file of ["\\\\server\\share\\shot.png", "//server/share/shot.png", "\\\\?\\C:\\shot.png", "\\\\.\\pipe\\x"]) {
    assert.throws(() => parseArgs(["--smoke", "--screenshot", file]), /--screenshot/, file);
  }
  assert.equal(parseArgs(["--smoke", "--screenshot", "C:\\out\\shot.png"]).screenshot, "C:\\out\\shot.png");
  assert.equal(parseArgs(["--smoke", "--screenshot=out/shot.png"]).screenshot, "out/shot.png");
});
