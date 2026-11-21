import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";
import { FRICTION_FAMILIES } from "@storytree/session-management/friction/verbs";

import { parseArgs } from "../args.js";
import type { Context, Family } from "../door.js";
import "../usage/learner.js";
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
  const named: Context = { ...context, library: async () => ({ name: "p" }) as Library, activityContext: async () => { throw new Error("no activity log here"); } };
  const unnamed = await learning(drained, surfaces).verbs[0]!.act(parseArgs([], [], process.cwd()), named);
  assert.match(unnamed.text, /^No friction is due\.\nThe doors learner did not run: A write names where it goes/);
  const placed = await learning(drained, surfaces).verbs[0]!.act(parseArgs(["--project", "p"], [], process.cwd()), named);
  assert.equal(placed.text, "No friction is due.\nThe doors learner did not run: no activity log here");
  const other: Family = { ...drained, name: "resteer" };
  assert.equal(learning(other, surfaces), other);

  assert.ok(twinsOf(FRICTION_FAMILIES).some(({ command, tool }) => command === "storytree friction drain" && tool === "friction_drain"), "a verb both doors mount is one twin");
});

test("1.38 · `storytree doors learn --session <id>` runs the doors learner on the session it names, writing as that session, and refuses without one", async () => {
  const none = async (): Promise<never> => { throw new Error("no library here"); };
  const library = { name: "p" } as Library;
  const context: Context = {
    cwd: process.cwd(), out: () => {}, library: async () => library, server: none, writer: () => ({ actor: "person:me" }), claims: none, activityContext: none, claimContext: none, journey: none,
  };
  const ran: unknown[] = [];
  const verb = learner(async (_context, _surfaces, as) => {
    ran.push(as);
    return ["The doors learner read 0 door-answered lines from 0 sessions over 28 days (ADR-1045 D4 to D6)."];
  });
  const answer = await verb.act(parseArgs(["--session", "s1", "--harness", "codex", "--project", "p"], verb.switches ?? [], process.cwd()), context);
  assert.equal(answer.text, "The doors learner read 0 door-answered lines from 0 sessions over 28 days (ADR-1045 D4 to D6).");
  assert.deepEqual(ran, [{ caller: { session: "s1", harness: "codex" }, writer: { actor: "session:s1" }, library }]);
  await assert.rejects(verb.act(parseArgs([], verb.switches ?? [], process.cwd()), context), (error: Error & { code?: number }) => error.code === 2 && /--session/.test(error.message));
});
