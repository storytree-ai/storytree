/** App capability 4 · Updates: what the gear's Updates section says for each state of an update. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { updateText } from "./updates.js";

const at = { runningBuild: "0.3.400 (abc1234)", nextBuild: "0.3.401 (def5678)" };

test("4.8 the Updates section says when a new build is building, ready and restarting, naming that build", () => {
  const said = (["building", "ready", "restarting"] as const).map((phase) => updateText({ ...at, phase }));
  assert.equal(new Set(said.map(([title]) => title)).size, 3, "each state reads differently");
  for (const [title, detail] of said) {
    assert.notEqual(title, "");
    assert.match(detail, /0\.3\.401/);
  }
});

test("4.9 a failed update says its reason and that the running app is unchanged", () => {
  const [title, detail] = updateText({ ...at, phase: "failed", reason: "The build stopped at typecheck." });
  assert.notEqual(title, "");
  assert.match(detail, /The build stopped at typecheck\./);
  assert.match(detail, /unchanged/);
});

test("4.10 an app not running from a runtime slot says it does not update itself", () => {
  const [, detail] = updateText({ ...at, phase: "unavailable" });
  assert.match(detail, /does not update itself/);
});
