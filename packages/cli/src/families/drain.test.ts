/** The command line 1.34: `storytree friction drain` runs the doors learner after the drain, which a learner's failure never stops; 1.38: `storytree doors learn` runs it for the tool server's drain. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { FRICTION_FAMILIES } from "@storytree/session-management/friction/verbs";

import { parseArgs } from "../args.js";
import type { Context, Family } from "../door.js";
import { learner } from "./doors.js";
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

test("1.38 · `storytree doors learn --session <id>` runs the doors learner on the session it names, writing as that session, and refuses without one", async () => {
  const none = async (): Promise<never> => { throw new Error("no library here"); };
  const context: Context = {
    cwd: process.cwd(), out: () => {}, library: none, server: none, writer: () => ({ actor: "person:me" }), claims: none, activityContext: none, claimContext: none, journey: none,
  };
  const ran: unknown[] = [];
  const verb = learner(async (_context, _surfaces, as) => {
    ran.push(as);
    return ["The doors learner read 0 door-answered lines from 0 sessions over 28 days (ADR-1045 D4 to D6)."];
  });
  const answer = await verb.act(parseArgs(["--session", "s1", "--harness", "codex"], verb.switches ?? [], process.cwd()), context);
  assert.equal(answer.text, "The doors learner read 0 door-answered lines from 0 sessions over 28 days (ADR-1045 D4 to D6).");
  assert.deepEqual(ran, [{ caller: { session: "s1", harness: "codex" }, writer: { actor: "session:s1" } }]);
  await assert.rejects(verb.act(parseArgs([], verb.switches ?? [], process.cwd()), context), (error: Error & { code?: number }) => error.code === 2 && /--session/.test(error.message));
});
