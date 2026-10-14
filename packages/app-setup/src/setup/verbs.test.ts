/**
 * Capability 8 · Setup check: the `doctor` and `setup` families the app setup declares for the command line, at their
 * places among `storytree`'s families, and `setup`'s bare verb run beside a stand-in for the installed setup script.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal, type DoorWords, type Verb } from "@storytree/library/verbs";

import { SETUP_FAMILIES, type SetupVerbContext } from "../verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("8.10 · the app setup declares doctor, setup, project and import at their places, each run without a caller but import; setup install | remove runs the installed setup script, and any other word is a misuse", async (t) => {
  assert.deepEqual(SETUP_FAMILIES.map((family) => [family.name, family.order]), [["doctor", 8], ["setup", 20], ["project", 21], ["import", 22]]);
  const verbs = SETUP_FAMILIES.flatMap((family) => [...(family.bare === undefined ? [] : [family.bare]), ...family.verbs]);
  assert.deepEqual(verbs.filter((one) => !one.callerless).map((one) => "name" in one.command && one.command.name), ["import"]);

  const dir = mkdtempSync(path.join(tmpdir(), "setup-verbs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "storytree-setup.mjs"), "console.log(JSON.stringify(process.argv.slice(2)));");
  const setup = SETUP_FAMILIES.find((family) => family.name === "setup")!.bare! as Verb<never, SetupVerbContext>;
  const context: SetupVerbContext = { folder: dir, script: path.join(dir, "storytree.mjs") };
  for (const action of ["install", "remove"]) assert.deepEqual(JSON.parse((await setup.act({ action } as never, context, WORDS)).text), [action]);
  for (const action of [undefined, "both"]) {
    await assert.rejects(setup.act({ action } as never, context, WORDS), (error: unknown) => error instanceof VerbRefusal && error.misuse);
  }
  await assert.rejects(setup.act({ action: "install" } as never, { folder: dir }, WORDS), /runs from an installed storytree/);
});
