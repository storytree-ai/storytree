/** Capability 6 · Social sign-in and session, contract 6.4, as the declared `sign-in`, `status` and `sign-out` answer it unconfigured. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DoorWords } from "@storytree/library/verbs";

import { IDENTITY_FAMILIES } from "./verbs.js";

const words: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };

test("6.4 without a client ID, the declared sign-in, status and sign-out each answer that sign-in is not configured, needing no caller", async (t) => {
  const was = process.env.STORYTREE_WORKOS_CLIENT_ID;
  process.env.STORYTREE_WORKOS_CLIENT_ID = "";
  t.after(() => {
    if (was === undefined) delete process.env.STORYTREE_WORKOS_CLIENT_ID;
    else process.env.STORYTREE_WORKOS_CLIENT_ID = was;
  });
  assert.deepEqual(IDENTITY_FAMILIES.map((family) => family.name), ["sign-in", "status", "sign-out"]);
  for (const family of IDENTITY_FAMILIES) {
    assert.equal(family.bare!.callerless, true);
    const answer = await family.bare!.act({}, { folder: process.cwd(), out: () => assert.fail("nothing is printed before the answer") }, words);
    assert.match(answer.text, family.name === "sign-in" ? /^Sign-in is not configured/ : /^Signed out\. Sign-in is not configured/);
  }
});
