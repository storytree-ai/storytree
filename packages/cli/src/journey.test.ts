/** Journey events 3.3: persisted consent controls are reachable from the offline command line. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { BuiltCommand, storytree } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("journey events 3.3: help does nothing; status, off and deletion work offline while unconfigured opt-in is refused", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-journey-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const invoke = (args: string[]) => storytree(command.script, args, { cwd: dir, home });

  const help = await invoke(["journey", "on", "--help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /storytree journey on/);
  assert.equal(existsSync(home), false, "help must not create journey state");

  const status = await invoke(["journey", "status"]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /not chosen.*off/i);

  const on = await invoke(["journey", "on"]);
  assert.equal(on.code, 1, on.stderr);
  assert.match(on.stderr, /configur|available|ready|owner/i);
  assert.match((await invoke(["journey", "status"])).stdout, /not chosen.*off/i);

  const off = await invoke(["journey", "off"]);
  assert.equal(off.code, 0, off.stderr);
  assert.match((await invoke(["journey", "status"])).stdout, /off/i);

  const deletion = await invoke(["journey", "delete-request"]);
  assert.equal(deletion.code, 0, deletion.stderr);
  assert.match(deletion.stdout, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.match(deletion.stdout, /request|contact/i);

  for (const args of [["journey", "off", "extra"], ["journey", "status", "--key", "no-key-accepted"]]) {
    const refused = await invoke(args);
    assert.equal(refused.code, 2, refused.stderr);
    assert.match(refused.stderr, /usage: storytree journey/);
    assert.doesNotMatch(refused.stdout + refused.stderr, /no-key-accepted/);
  }
});
