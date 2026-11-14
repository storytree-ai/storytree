// The Mint box's factory-health tick (box/factory-health.sh), run from a throwaway copy standing for its runner checkout,
// with a stand-in pnpm that logs the folder and words of each command, and no factory clone, so the tick stops after its telling.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

const script = fileURLToPath(new URL("../../box/factory-health.sh", import.meta.url));

test("7.18 · the factory-health tick tells the verdict turns from the box's approved storytree checkout, never its own runner; with none there it says so and the tick goes on", { skip: process.platform === "win32" ? "platform:linux: the tick is the Mint box's bash" : false }, async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "factory-health-tick-")));
  t.after(() => removeTemp(root));
  const runner = path.join(root, "runner");
  const tick = path.join(runner, "packages", "repo-checks", "box", "factory-health.sh");
  mkdirSync(path.dirname(tick), { recursive: true });
  copyFileSync(script, tick);
  const checkout = path.join(root, "storytree");
  mkdirSync(checkout);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const calls = path.join(root, "calls.log");
  writeFileSync(path.join(bin, "pnpm"), `#!/usr/bin/env bash\necho "$PWD: $*" >> "${calls}"\n`);
  chmodSync(path.join(bin, "pnpm"), 0o755);
  const run = (tellFrom) => {
    writeFileSync(calls, "");
    const out = execFileSync("bash", [tick], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STORYTREE_FACTORY: path.join(root, "no-factory"), STORYTREE_FACTORY_HEALTH_LAST: path.join(root, "last"), STORYTREE_TELL_FROM: tellFrom },
    });
    return { out, tells: readFileSync(calls, "utf8").split("\n").filter((line) => line.endsWith("storytree health tell")) };
  };

  const told = run(checkout);
  assert.deepEqual(told.tells, [`${checkout}: -s storytree health tell`]);
  assert.match(told.out, /no factory clone/);

  const none = run(path.join(root, "missing"));
  assert.deepEqual(none.tells, []);
  assert.match(none.out, /no storytree checkout at .*missing/);
  assert.match(none.out, /no factory clone/);
});
