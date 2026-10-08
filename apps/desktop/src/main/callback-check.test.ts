import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs } from "./args.js";
import { routeCallback } from "./callback-check.js";

test("1.15 under --callback-check, each sign-in callback handed to the app is reported, saying whether it reached the sign-in session", async () => {
  assert.equal(parseArgs(["--callback-check"]).callbackCheck, true);
  assert.equal(parseArgs([]).callbackCheck, false);

  const url = "storytree-auth://callback?code=fabricated&state=x";
  const lines: string[] = [];
  const report = (line: string) => lines.push(line);

  // A build with no sign-in (CI's) says the callback arrived and that no session takes it.
  assert.equal(routeCallback(url, { offered: false, session: undefined, early: [], report }), "dropped");
  // Before the session is made, the callback is kept for it.
  const early: string[] = [];
  assert.equal(routeCallback(url, { offered: true, session: undefined, early, report }), "kept");
  assert.deepEqual(early, [url]);
  // Once it is made, the session gets the callback; its failed exchange is the session's to say, not the route's.
  const handed: string[] = [];
  const session = { callback: async (link: string) => { handed.push(link); throw new Error("invalid code"); } };
  assert.equal(routeCallback(url, { offered: true, session, early: [], report }), "delivered");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(handed, [url]);

  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line, /^sign-in callback received: storytree-auth:\/\/callback/);
    assert.doesNotMatch(line, /fabricated/, "the report never carries the callback's code");
  }
  assert.match(lines[0]!, /no sign-in session/);
  assert.match(lines[1]!, /kept until the sign-in session/);
  assert.match(lines[2]!, /reached the sign-in session/);

  // Without the check, nothing is reported.
  assert.equal(routeCallback(url, { offered: false, session: undefined, early: [] }), "dropped");
  assert.equal(lines.length, 3);
});
