/** Settings' thin front door runs offline, outside a project, with a throwaway home. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { readSettings } from "@storytree/agent-link";

import { BuiltCommand, storytree } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("settings 10.1–10.6: the offline CLI shows, persists and refuses invalid changes, the library location included", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });

  const defaults = await invoke(["settings", "show"]);
  assert.equal(defaults.code, 0, defaults.stderr);
  assert.match(defaults.stdout, /context-guidance.*700000.*default/);

  const set = await invoke(["settings", "set", "context-guidance", "400000"]);
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stdout, /context-guidance.*400000.*set/);
  const file = path.join(home, "settings.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "context-guidance": 400_000 });
  assert.equal(readSettings(home)["context-guidance"].value, 400_000);
  assert.equal(readSettings(home)["context-guidance"].source, "set");

  const show = await invoke(["settings", "show"]);
  assert.equal(show.code, 0, show.stderr);
  assert.match(show.stdout, /context-guidance.*400000.*set/);
  assert.match(show.stdout, /positive whole number/);
  assert.match(show.stdout, /tokens/);
  assert.match(show.stdout, /default.*700000/);
  assert.match(show.stdout, /soft/i);

  const help = await invoke([]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /^\s+settings\b/m);
  const family = await invoke(["settings"]);
  assert.match(family.stdout, /storytree settings show/);
  assert.match(family.stdout, /storytree settings set <name> <value>/);

  for (const args of [["show", "extra"], ["set", "context-guidance"], ["set", "context-guidance", "1", "extra"], ["show", "--unknown=yes"]]) {
    const refused = await invoke(["settings", ...args]);
    assert.equal(refused.code, 2, refused.stderr);
    assert.match(refused.stderr, /usage: storytree settings/);
    assert.equal(readSettings(home)["context-guidance"].value, 400_000);
  }

  const before = readFileSync(file, "utf8");
  for (const [name, value, reason] of [["quiet-time", "1", /unknown setting/i], ["context-guidance", "-1", /positive whole number/i]] as const) {
    const refused = await invoke(["settings", "set", name, value]);
    assert.equal(refused.code, 1, refused.stderr);
    assert.match(refused.stderr, reason);
    assert.equal(readFileSync(file, "utf8"), before);
  }

  writeFileSync(file, '{"context-guidance":null}');
  for (const args of [["show"], ["set", "context-guidance", "400000"]]) {
    const refused = await invoke(["settings", ...args]);
    assert.equal(refused.code, 1, refused.stderr);
    assert.match(refused.stderr, /invalid settings file/i);
    assert.ok(refused.stderr.includes(file), refused.stderr);
    assert.equal(readFileSync(file, "utf8"), '{"context-guidance":null}');
  }

  writeFileSync(file, "{}");
  assert.match((await invoke(["settings", "show"])).stdout, /library: local \(default\)/);
  const cloud = await invoke(["settings", "set", "library", "cloudsql", "my-project:australia-southeast1:my-instance", "you@example.com"]);
  assert.equal(cloud.code, 0, cloud.stderr);
  assert.match(cloud.stdout, /library: cloudsql my-project:australia-southeast1:my-instance as you@example.com \(set\)/);
  assert.match((await invoke(["settings", "show"])).stdout, /library: cloudsql .* \(set\)/);
  const saved = readFileSync(file, "utf8");
  const refused = await invoke(["settings", "set", "library", "cloudsql", "not-a-connection-name", "you@example.com"]);
  assert.equal(refused.code, 1, refused.stderr);
  assert.match(refused.stderr, /project:region:instance/);
  assert.equal(readFileSync(file, "utf8"), saved);
  const local = await invoke(["settings", "set", "library", "local"]);
  assert.equal(local.code, 0, local.stderr);
  assert.match(local.stdout, /library: local \(set\)/);
});
