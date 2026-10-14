/**
 * Capability 1 · Front door: contract 1.24, the mount of a declared verb, called with a context whose library cannot open.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { verb, type VerbPlace } from "@storytree/project-and-caller/verbs";

import { Refusal } from "./answer.js";
import { parseArgs } from "./args.js";
import type { Context } from "./door.js";
import { command, type CommandPlace } from "./mount.js";

const runtime = { record: () => {} };
const noLibrary = (): never => { throw new Error("the library was opened"); };
const context = {
  cwd: "/not-a-project",
  script: "/opt/storytree/storytree.mjs",
  out: () => {},
  library: noLibrary,
  server: noLibrary,
  writer: noLibrary,
  claims: noLibrary,
  activityContext: noLibrary,
  claimContext: noLibrary,
  journey: async () => runtime,
} as unknown as Context;

const status = verb({
  command: { family: "journey", name: "status", summary: "say whether journey events are on" },
  tool: { absent: "the person's own setting" },
  inputs: {},
  callerless: true,
  async act(_input, place: VerbPlace & Partial<CommandPlace>) {
    const journey = await place.journey!();
    return { text: `${place.folder} ${place.script} ${journey === runtime ? "runtime" : "another"}` };
  },
});

test("1.24 · the command line mounts a callerless verb without opening the library, handing it the folder, script and journey runtime; a word or flag a verb does not take is refused with code 2 and its usage", async () => {
  const mounted = command(status);
  assert.equal((await mounted.act(parseArgs([], [], context.cwd), context)).text, "/not-a-project /opt/storytree/storytree.mjs runtime");

  for (const stray of [["extra"], ["--key", "x"]]) {
    await assert.rejects(mounted.act(parseArgs(stray, [], context.cwd), context), (error: unknown) => error instanceof Refusal && error.code === 2 && error.message.endsWith("\nusage: storytree journey status") && !error.message.includes("extra"));
  }

  // A verb that is not callerless opens the caller.
  const { callerless: _callerless, ...called } = status;
  await assert.rejects(command(called).act(parseArgs([], [], context.cwd), context), /the library was opened/);
});
