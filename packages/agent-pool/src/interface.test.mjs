import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { setFactory, setPartOff } from "@storytree/project-and-caller";
import { removeTemp } from "@storytree/test-waits";

import { agentRunnerEntry } from "./interface.mjs";

function home(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-runner-interface-")));
  t.after(() => removeTemp(dir));
  return dir;
}

test("3.34 · a dependent reaches the lane runner and the ready pool through the agent runner's declared interface: the base's own while the part is on, the stand-in's while it is off, and nothing with no stand-in", (t) => {
  const at = home(t);
  assert.equal(agentRunnerEntry("./runner", at), fileURLToPath(new URL("./runner.mjs", import.meta.url)));
  assert.equal(agentRunnerEntry("./launch", at), fileURLToPath(new URL("./launch.mjs", import.meta.url)));
  assert.throws(() => agentRunnerEntry("./watch", at), /declares no "\.\/watch" in its interface; it declares \.\/launch, \.\/runner/);

  const factory = join(at, "factory");
  const plugin = join(factory, "plugins", "my-runner");
  mkdirSync(join(plugin, "src"), { recursive: true });
  writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "my-runner", exports: { "./runner": "./src/runner.mjs", "./launch": "./src/launch.mjs" }, storytree: { interface: 1, for: "agent-pool" } }));
  setFactory(factory, at);
  setPartOff("agent-pool", true, at, "my-runner");
  assert.equal(agentRunnerEntry("./runner", at), join(plugin, "src", "runner.mjs"));
  assert.equal(agentRunnerEntry("./launch", at), join(plugin, "src", "launch.mjs"));

  setPartOff("agent-pool", false, at);
  assert.equal(agentRunnerEntry("./runner", at), fileURLToPath(new URL("./runner.mjs", import.meta.url)), "switched back on, the base's again");
  setPartOff("agent-pool", true, at);
  assert.throws(() => agentRunnerEntry("./runner", at), /agent-pool is switched off on this computer and no factory plugin stands in for it/);
});
