/**
 * Capability 17 · Friction, its verbs (17.15-17.18): the `friction` and `resteer`
 * verbs Session management declares for both front doors, run with a context of a fresh project's library on the real Postgres
 * `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { removeTemp, waitUntil } from "@storytree/test-waits";

import type { Library } from "@storytree/library";
import { consumersOf, mounted, VerbRefusal, type DoorWords, type VerbContext } from "@storytree/library/verbs";

import { recordFriction } from "./filing/capture.js";
import { withLibrary } from "./testing/pg.js";
import { FRICTION_FAMILIES, FRICTION_TOOLS } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("17.17 · Session management declares the `friction` and `resteer` families the command line lists 13th and 14th: friction filed on one branch, with its links and the writer, is drained on another", async () => {
  await withLibrary(async (library) => {
    const [friction, resteer] = ["friction", "resteer"].map((name) => FRICTION_FAMILIES.find((family) => family.name === name)!);
    assert.deepEqual([friction!.order, resteer!.order], [13, 14]);
    const verbOf = (name: string) => friction!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
    const folder = mkdtempSync(path.join(tmpdir(), "friction-verbs-"));
    try {
      execFileSync("git", ["-C", folder, "init", "-q", "-b", "fix/mail"]);
      const context: VerbContext = { library, project: "p", session: "s", folder, writer: { actor: "session:s" } };
      const decision = await library.recordDecision({ title: "Mail by queue", text: "Send mail from a queue.", status: "proposed" });
      const filed = await verbOf("new").act({
        title: "Slow mail",
        description: "Mail is delayed",
        statement: "Sending times out",
        evidence: "src/mail.ts: TimeoutError after 30 seconds",
        impact: "Readers cannot join",
        links: decision.id,
      }, context, WORDS);
      const [note] = await library.list("friction");
      assert.equal(filed.text, `Recorded friction ${note!.id}.`);
      assert.equal(note!.fields.provenance?.branch, "fix/mail");
      assert.deepEqual(note!.fields.links, [decision.id]);
      assert.equal((await library.history({ id: note!.id })).at(-1)?.actor, "session:s");

      assert.match((await verbOf("drain").act({}, context, WORDS)).text, /^No friction is due/, "its own branch's report is not drained");
      execFileSync("git", ["-C", folder, "checkout", "-q", "-b", "main"]);
      assert.match((await verbOf("drain").act({}, context, WORDS)).text, new RegExp(`^1 friction report due for routing:\\n  ${note!.id}  \\(0 recurrences\\)  Slow mail$`));
    } finally {
      await removeTemp(folder);
    }
  });
});

const verbNamed = (name: string) => FRICTION_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === name)!;

/** Run `body` with a context in a fresh Git folder on `branch`, as session s. */
async function onBranch(library: Library, branch: string, body: (context: VerbContext) => Promise<void>): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), "friction-verbs-"));
  try {
    execFileSync("git", ["-C", folder, "init", "-q", "-b", branch]);
    await body({ library, project: "p", session: "s", folder, writer: { actor: "session:s" } });
  } finally {
    await removeTemp(folder);
  }
}

test("17.15 · `friction route` records the route and reason with the writer; a tool route with no remedy is refused unchanged and writes nothing", async () => {
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const note = await recordFriction(library, { title: "Slow mail", description: "Delay", statement: "Timeout", evidence: "src/mail.ts: TimeoutError", impact: "Readers cannot join" });
      const history = await library.history();
      await assert.rejects(verbNamed("route").act({ friction: note.id, to: "tool", reason: "Needs a retry" }, context, WORDS), (error: Error) => error instanceof VerbRefusal && /live increment whose remedies names/.test(error.message));
      assert.deepEqual(await library.history(), history, "refusal writes nothing");

      await verbNamed("route").act({ friction: note.id, to: "tool", reason: "Retry landed", "discharged-by": "storytree-ai/storytree#9" }, context, WORDS);
      const saved = (await library.list("friction"))[0]!;
      assert.deepEqual([saved.fields.route, saved.fields.routeReason, saved.fields.dischargedBy], ["tool", "Retry landed", "storytree-ai/storytree#9"]);
      assert.equal((await library.history({ id: note.id })).at(-1)?.actor, "session:s");
    });
  });
});

test("17.16 · `friction drain` lists the unrouted reports other branches filed for the calling branch, most recurrences first, and says how many more wait", async () => {
  await withLibrary(async (library) => {
    const fields = { description: "Delay", statement: "Timeout", evidence: "src/mail.ts: Error", impact: "Wait" };
    const provenance = (branch: string) => ({ branch, date: "2026-09-29", source: "retro" as const });
    const older = await library.writeKnowledge("friction", { ...fields, title: "Older", provenance: provenance("another/branch") });
    const recurring = await library.writeKnowledge("friction", { ...fields, title: "Recurring", provenance: provenance("another/branch") });
    await library.editNote(recurring.id, { reinforcedBy: [{ date: "2026-09-29", branch: "third/branch", evidence: "#8: again" }] });
    await library.writeKnowledge("friction", { ...fields, title: "Mine", provenance: provenance("fix/mail") });
    const routed = await library.writeKnowledge("friction", { ...fields, title: "Routed", provenance: provenance("another/branch") });
    await library.editNote(routed.id, { route: "nothing", routeReason: "Passed" });
    const later: { id: string }[] = [];
    // Creation time is to the millisecond and ties fall to the random id, so each report is written in a later millisecond.
    for (const title of ["Third", "Fourth"]) {
      const from = Date.now();
      await waitUntil(() => Date.now() > from, 1_000, "the next millisecond");
      later.push(await library.writeKnowledge("friction", { ...fields, title, provenance: provenance("another/branch") }));
    }

    await onBranch(library, "fix/mail", async (context) => {
      const drained = await verbNamed("drain").act({}, context, WORDS);
      const listed = drained.text.split("\n").filter((line) => line.includes("friction_")).map((line) => line.match(/friction_[0-9a-f]+/)![0]);
      assert.deepEqual(listed, [recurring.id, older.id, later[0]!.id]);
      assert.match(drained.text, /1 more wait/);
    });
  });
});

test("17.18 · Session management declares record_friction, reinforce, record_resteer, friction_drain and route as tools, the drain an agent's alone, and its refusals are verb refusals, which each door answers as a refusal", async () => {
  const tools = FRICTION_TOOLS.flatMap((one) => (mounted(one.tool) ? [one.tool.name] : []));
  assert.deepEqual(tools.sort(), ["friction_drain", "record_friction", "record_resteer", "reinforce", "route"]);
  assert.deepEqual(consumersOf(FRICTION_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "friction_drain")!), ["agent"]);
  await withLibrary(async (library) => {
    await onBranch(library, "main", async (context) => {
      const record = FRICTION_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "record_friction")!;
      await assert.rejects(record.act({ title: "Slow", description: "Slow", statement: "Slow", evidence: "it was slow", impact: "Slow" }, context, WORDS), VerbRefusal);
      assert.deepEqual(await library.history(), []);
    });
  });
});
