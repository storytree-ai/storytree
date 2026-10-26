/**
 * Capability 17 · Friction, its filing: one test per contract 17.1-17.7, filing through the declared friction verbs
 * (both doors mount them) and its public capture functions, each in a fresh project's library on the real Postgres
 * `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import type { Library } from "@storytree/library";
import { VerbRefusal, type DoorWords, type VerbAnswer, type VerbContext } from "@storytree/library/verbs";

import { withLibrary } from "../testing/pg.js";
import { FRICTION_FAMILIES } from "../verbs.js";
import { CaptureError, recordFriction, reinforceFriction } from "../index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
/** The day capture stamps, pinned by mocking the clock at its noon (UTC). */
const DAY = "2026-03-04";
const pinDay = (t: TestContext) => t.mock.timers.enable({ apis: ["Date"], now: Date.parse(`${DAY}T12:00:00Z`) });

/** Run Friction's `family name` verb with `input` as `actor`, in `folder`. */
function run(library: Library, folder: string, actor: string, family: string, name: string, input: Record<string, unknown>): Promise<VerbAnswer> {
  const declared = FRICTION_FAMILIES.find((one) => one.name === family)!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
  const context: VerbContext = { library, project: "p", session: actor, folder, writer: { actor } };
  return declared.act(input as never, context, WORDS);
}

/** Run `body` in a fresh folder, a Git repository on `branch` when one is given. */
async function inFolder(branch: string | undefined, body: (folder: string) => Promise<void>): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), "friction-"));
  try {
    if (branch !== undefined) execFileSync("git", ["-C", folder, "init", "-q", "-b", branch]);
    await body(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const report = (title: string, evidence = `src/${title}.ts: Error`) => ({ title, description: title, statement: title, evidence, impact: "Lost time" });
const resteer = { title: "Simpler", description: "Less UI", doing: "Many fields", redirect: "Just email", disposition: "taste", "judged-by": "owner" };

test("17.1 · friction with vague evidence is refused and writes nothing; concrete evidence is captured with its writer", async () => {
  await withLibrary(async (library) => {
    await inFolder("fix/mail", async (folder) => {
      await assert.rejects(run(library, folder, "session:s", "friction", "new", report("Slow", "It was slow and annoying")), (error: Error) => error instanceof CaptureError && /evidence must be concrete/.test(error.message));
      assert.deepEqual(await library.history(), []);

      const filed = await run(library, folder, "session:s", "friction", "new", report("Slow", "src/mail.ts: TimeoutError\nThe request took 30 seconds."));
      const [note] = await library.list("friction");
      assert.equal(filed.data?.id, note!.id);
      assert.equal(note!.fields.evidence, "src/mail.ts: TimeoutError\nThe request took 30 seconds.");
      assert.equal(note!.fields.route, undefined, "capture never routes");
      assert.equal((await library.history()).at(-1)?.actor, "session:s");
    });
  });
});

test("17.2 · a re-steer whose evidence is a paraphrase is refused; the quote and the self-report stay apart", async () => {
  await withLibrary(async (library) => {
    await inFolder(undefined, async (folder) => {
      await assert.rejects(run(library, folder, "session:s", "resteer", "new", { ...resteer, evidence: "The owner wanted fewer fields" }), CaptureError);
      assert.deepEqual(await library.history(), []);

      await run(library, folder, "session:s", "resteer", "new", { ...resteer, evidence: '"Use just email"', "self-report": "I made the form too long" });
      const [note] = await library.list("resteer");
      assert.equal(note!.fields.evidence, '"Use just email"');
      assert.equal(note!.fields.selfReport, "I made the form too long");
      assert.equal(note!.fields.dispositionBy, "owner");
    });
  });
});

test("17.3 · reinforce appends a dated recurrence on the calling branch to the existing friction, keeping the route of a routed one", async (t) => {
  pinDay(t);
  await withLibrary(async (library) => {
    await inFolder("fix/mail", async (folder) => {
      const note = await recordFriction(library, report("Slow mail", "src/mail.ts: TimeoutError"));
      await library.editNote(note.id, { route: "process", routeReason: "Upstream outage" });
      for (const evidence of ["#81: timed out again", "src/mail.ts: another TimeoutError"]) {
        assert.equal((await run(library, folder, "session:s", "friction", "reinforce", { friction: note.id, evidence })).data?.id, note.id);
      }
      const [saved, ...twins] = await library.list("friction");
      assert.deepEqual(twins, []);
      assert.deepEqual([saved!.fields.route, saved!.fields.routeReason], ["process", "Upstream outage"]);
      assert.deepEqual(saved!.fields.reinforcedBy, [
        { branch: "fix/mail", date: DAY, evidence: "#81: timed out again" },
        { branch: "fix/mail", date: DAY, evidence: "src/mail.ts: another TimeoutError" },
      ]);
      const history = await library.history();
      await assert.rejects(run(library, folder, "session:s", "friction", "reinforce", { friction: note.id, evidence: "It happened again" }), /concrete/);
      assert.deepEqual(await library.history(), history);
    });
  });
});

test("17.4 · capture stamps the calling folder's branch and UTC date and refuses a fourth report on that branch that day, routed ones counted, naming the cap and friction reinforce, with nothing written; a defect with no failure mode is refused", async (t) => {
  pinDay(t);
  await withLibrary(async (library) => {
    await inFolder("fix/mail", async (folder) => {
      for (const provenance of [{ branch: "another/branch", date: DAY }, { branch: "fix/mail", date: "2000-01-01" }]) {
        await library.writeKnowledge("friction", { ...report("Old"), provenance: { ...provenance, source: "retro" as const } });
      }
      const filed = [];
      for (const title of ["one", "two", "three"]) filed.push((await run(library, folder, "session:s", "friction", "new", report(title))).data?.id as string);
      await library.editNote(filed[2]!, { route: "nothing", routeReason: "Outage passed" });
      const first = await library.get(filed[0]!);
      assert.ok(first?.type === "friction");
      assert.deepEqual(first.fields.provenance, { branch: "fix/mail", date: DAY, source: "retro" });

      const history = await library.history();
      await assert.rejects(run(library, folder, "session:s", "friction", "new", report("four")), (error: Error) =>
        error instanceof CaptureError && /3 friction.*fix\/mail/.test(error.message) && error.message.includes(DAY) && /friction reinforce/.test(error.message));
      assert.deepEqual(await library.history(), history, "refusal writes nothing");
      await run(library, folder, "session:s", "friction", "reinforce", { friction: filed[0], evidence: "#81: again" });
      execFileSync("git", ["-C", folder, "symbolic-ref", "HEAD", "refs/heads/fix/other"]);
      await run(library, folder, "session:s", "friction", "new", report("elsewhere"));

      const before = await library.history();
      await assert.rejects(run(library, folder, "session:s", "resteer", "new", { ...resteer, evidence: '"not like that"', disposition: "defect", "judged-by": "agent" }), /mode/);
      assert.deepEqual(await library.history(), before);
    });
  });
});

test("17.5 · reinforcing through the public capture function appends dated concrete evidence to the same item, keeps a routed one's route and reopens a dismissed one; invalid recurrences write nothing", async (t) => {
  pinDay(t);
  await withLibrary(async (library) => {
    const friction = await recordFriction(library, report("Slow mail", "src/mail.ts: TimeoutError"));
    await library.editNote(friction.id, { route: "nothing", routeReason: "An upstream outage" });
    const reopened = await reinforceFriction(library, friction.id, { branch: "fix/mail", evidence: "src/mail.ts: TimeoutError again" }, { actor: "person:Sam" });
    assert.equal(reopened.id, friction.id);
    assert.equal(reopened.fields.state, "open", "a dismissed report reopens");
    assert.deepEqual(reopened.fields.reinforcedBy, [{ branch: "fix/mail", date: DAY, evidence: "src/mail.ts: TimeoutError again" }]);
    assert.equal((await library.history({ id: friction.id })).at(-1)?.actor, "person:Sam");

    const note = await library.defineTerm({ term: "Delivery", meaning: "Not friction" });
    const before = await library.history();
    for (const [id, evidence] of [[friction.id, "It happened again"], [note.id, "src/mail.ts"], ["missing", "src/mail.ts"]] as const) {
      await assert.rejects(reinforceFriction(library, id, { branch: "fix/mail", evidence }), CaptureError);
    }
    assert.deepEqual(await library.history(), before, "refused recurrences wrote nothing");
  });
});

test("17.6 · the daily cap counts each writer's own reports: on a branch every session shares, a second session's report is accepted after another filed three that day, and each is still refused its own fourth; a report whose writer was not recorded counts toward every writer's three", async (t) => {
  pinDay(t);
  await withLibrary(async (library) => {
    await inFolder("main", async (folder) => {
      for (const title of ["one", "two", "three"]) await run(library, folder, "session:first", "friction", "new", report(title));
      await assert.rejects(run(library, folder, "session:first", "friction", "new", report("four")), CaptureError);
      for (const title of ["islands", "bridges", "tunnels"]) await run(library, folder, "session:second", "friction", "new", report(title));
      await assert.rejects(run(library, folder, "session:second", "friction", "new", report("ferries")), CaptureError);

      await library.writeKnowledge("friction", { ...report("unsigned"), provenance: { branch: "main", date: DAY, source: "retro" as const } });
      for (const title of ["roads", "rails"]) await run(library, folder, "session:third", "friction", "new", report(title));
      await assert.rejects(run(library, folder, "session:third", "friction", "new", report("canals")), CaptureError, "the unsigned report counts toward the third session's three");
      assert.equal((await library.list("friction")).length, 9);
    });
  });
});

test("17.7 · a re-steer whose evidence is the user's exact words without quotation marks is refused naming the step that passes, and the same words inside double quotation marks are then recorded", async () => {
  await withLibrary(async (library) => {
    await inFolder(undefined, async (folder) => {
      const words = "I know Your Feed was meant for part 5, but the tests expect the tab to be there as soon as people can sign in. Can you add it now?";
      await assert.rejects(run(library, folder, "session:s", "resteer", "new", { ...resteer, evidence: words }), (error: Error) => error instanceof VerbRefusal && /double quotation marks/.test(error.message));
      await run(library, folder, "session:s", "resteer", "new", { ...resteer, evidence: `"${words}"` });
      assert.equal((await library.list("resteer"))[0]?.fields.evidence, `"${words}"`);
    });
  });
});
