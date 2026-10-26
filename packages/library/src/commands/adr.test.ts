/**
 * Capability 13 · Decision log: contract 13.10, the `adr` verbs the library declares beside its own commands for the
 * command line, run with a context of a fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { DoorWords, VerbContext } from "../verbs/verb.js";

import { connect } from "../index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { ADR_FAMILY } from "./adr.js";
import { LIBRARY_FAMILIES } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("13.10 · the library declares the `adr` family the command line lists 4th: a pulled decision pushed back unedited writes nothing and never asks for the writer, and an edited title writes that field alone", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  const folder = mkdtempSync(path.join(tmpdir(), "library-adr-"));
  t.after(async () => {
    rmSync(folder, { recursive: true, force: true });
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);

  assert.equal(LIBRARY_FAMILIES.find((family) => family.name === "adr"), ADR_FAMILY);
  const adr = ADR_FAMILY;
  assert.equal(adr.order, 4);
  const verbOf = (name: string) => adr.verbs.find((one) => "name" in one.command && one.command.name === name)!;
  const decision = await library.recordDecision({ title: "Mail by queue", text: "Send mail from a queue.", status: "proposed" });
  let asked = 0;
  const context = { library, project: "p", session: "s", folder, get writer() { asked++; return { actor: "session:s" }; } } as VerbContext;

  await verbOf("pull").act({ decision: decision.id, out: "adr.md" }, context, WORDS);
  const before = (await library.changesSince(0)).cursor;
  const unedited = await verbOf("push").act({ decision: decision.id, file: "adr.md" }, context, WORDS);
  assert.match(unedited.text, /^No change/);
  assert.deepEqual((await library.changesSince(before)).changes, []);
  assert.equal(asked, 0, "a push that writes nothing names no writer");

  writeFileSync(path.join(folder, "adr.md"), readFileSync(path.join(folder, "adr.md"), "utf8").replace("# Mail by queue", "# Mail from a queue"));
  const edited = await verbOf("push").act({ decision: decision.id, file: "adr.md" }, context, WORDS);
  assert.equal(edited.text, `Pushed ${decision.id}: title.`);
  assert.equal((await library.decision(decision.id))?.record.fields.title, "Mail from a queue");
  assert.equal(asked, 1);
});
