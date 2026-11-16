/**
 * Capability 3 · First-run guide and capability 12 · Import an existing project: the `project` and `import` verbs the app
 * setup declares for the command line, refusing before they reach any library.
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal, type DoorWords, type Verb } from "@storytree/library/verbs";

import { SETUP_FAMILIES, type ImportVerbContext, type SetupVerbContext } from "../verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const refusal = (error: unknown) => error instanceof VerbRefusal && !error.misuse;

test("3.6 · project delete given a name it was not asked to delete is refused, saying to type the project's name", async () => {
  const project = SETUP_FAMILIES.find((family) => family.name === "project")!;
  const deleting = project.verbs.find((one) => "name" in one.command && one.command.name === "delete")! as Verb<never, SetupVerbContext>;
  await assert.rejects(deleting.act({ project: "shop", confirm: "shopp", "no-snapshot": true } as never, { folder: tmpdir() }, WORDS), (error: unknown) => refusal(error) && /Type the project’s name, “shop”/.test((error as Error).message));
});

test("12.3 · import of a folder that does not exist is refused, saying there is nothing to import", async () => {
  const importing = SETUP_FAMILIES.find((family) => family.name === "import")!.bare! as Verb<never, ImportVerbContext>;
  const context = { folder: tmpdir(), library: { name: "shop" }, server: {} } as unknown as ImportVerbContext;
  const gone = path.join(tmpdir(), "no-such-folder-for-import");
  await assert.rejects(importing.act({ folder: gone, project: "shop" } as never, context, WORDS), (error: unknown) => refusal(error) && /does not exist, so there is nothing to import/.test((error as Error).message));
});

test("12.11 · import names the project it writes to: naming none, or a project other than the folder's, is refused as a misuse naming the folder's, before anything is read (ADR-1348 D3)", async () => {
  const importing = SETUP_FAMILIES.find((family) => family.name === "import")!.bare! as Verb<never, ImportVerbContext>;
  const context = { folder: tmpdir(), library: { name: "shop" }, server: {} } as unknown as ImportVerbContext;
  const misuse = (pattern: RegExp) => (error: unknown) => error instanceof VerbRefusal && error.misuse && pattern.test(error.message);
  await assert.rejects(importing.act({ folder: "anything" } as never, context, WORDS), misuse(/names the project it writes to.*--project shop/));
  await assert.rejects(importing.act({ folder: "anything", project: "garden" } as never, context, WORDS), misuse(/this folder's own project, "shop", not "garden"/));
});
