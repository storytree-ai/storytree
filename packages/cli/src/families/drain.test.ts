/** The command line 1.34: `storytree friction drain` runs the doors learner after the drain, which a learner's failure never stops. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { FRICTION_FAMILIES } from "@storytree/session-management/friction/verbs";

import { parseArgs } from "../args.js";
import type { Context, Family } from "../door.js";
import { learning, twinsOf } from "./drain.js";

test("1.34 · the friction family's drain answers, then says what the doors learner did or why it did not run; every other family is mounted as it is", async () => {
  const drained: Family = { name: "friction", summary: "friction", verbs: [{ name: "drain", usage: "friction drain", summary: "drain", act: async () => ({ text: "No friction is due." }) }] };
  const none = async (): Promise<never> => { throw new Error("no library here"); };
  const context: Context = {
    cwd: process.cwd(), out: () => {}, library: none, server: none, writer: () => ({}), claims: none, activityContext: none, claimContext: none, journey: none,
  };
  const surfaces = async () => ({ commands: [], tools: [], twins: [] });
  const answer = await learning(drained, surfaces).verbs[0]!.act(parseArgs([], [], process.cwd()), context);
  assert.equal(answer.text, "No friction is due.\nThe doors learner did not run: no library here");
  const other: Family = { ...drained, name: "resteer" };
  assert.equal(learning(other, surfaces), other);

  assert.ok(twinsOf(FRICTION_FAMILIES).some(({ command, tool }) => command === "storytree friction drain" && tool === "friction_drain"), "a verb both doors mount is one twin");
});
