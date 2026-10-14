/**
 * Capability 17 · The library's commands: contract 17.1, the `library` family the library declares for the command
 * line, run with a caller on a fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "../project/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";
import { LIBRARY_FAMILIES, type HeldClaim, type LibraryVerbContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("17.1 · The library declares the library family first among storytree's families, its ten verbs as commands and none as a tool; a verb reads a phrase from @file in the caller's folder, and edit run by a session holding an increment holds a planned record's change on it", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-library-verbs-"));
  t.after(async () => {
    rmSync(folder, { recursive: true, force: true });
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);

  const [family] = LIBRARY_FAMILIES;
  assert.deepEqual([LIBRARY_FAMILIES.length, family!.name, family!.order], [1, "library", 1]);
  const names = family!.verbs.map((one) => mounted(one.command) ? one.command.name : undefined);
  assert.deepEqual(names, ["search", "phrase", "links", "related", "new", "read", "edit", "retire", "list", "history"]);
  assert.ok(family!.verbs.every((one) => !mounted(one.tool)), "no verb is a tool");
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family!.verbs[names.indexOf(name)]!;

  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Rename it", body: "Red then green" });
  const claims: HeldClaim[] = [{ session: "lane", increment: increment.id, since: "2026-10-15T00:00:00.000Z" }];
  const contextOf = (session: string): LibraryVerbContext => ({
    library, project, session, folder, writer: { actor: `session:${session}` },
    claims: async () => claims,
    testedNumbers: async () => ({ tested: [], untested: [] }),
  });

  const phrase = "  Exact phrase  ";
  const held = await library.defineTerm({ term: "Held", meaning: phrase });
  await library.defineTerm({ term: "Trimmed", meaning: phrase.trim() });
  writeFileSync(path.join(folder, "phrase.txt"), `﻿${phrase}`);
  const page = await verbOf("phrase").act({ phrase: ["@phrase.txt"], kind: [], field: ["meaning"], limit: undefined, after: undefined }, contextOf("lane"), WORDS);
  assert.deepEqual(JSON.parse(page.text).records.map((record: { id: string }) => record.id), [held.id], "the file's phrase, its spaces kept, is the one searched for");

  const pended = await verbOf("edit").act({ "<id>": form.id, "<fields>": { description: "Where they type it" } }, contextOf("lane"), WORDS);
  assert.match(pended.text, new RegExp(`pending on increment ${increment.id}`));
  assert.equal((await library.get(form.id))?.fields.description, undefined, "the live record is left alone");

  const live = await verbOf("edit").act({ "<id>": form.id, "<fields>": { description: "Typed here" } }, contextOf("person:owner"), WORDS);
  assert.equal(live.text, `Edited capability ${form.id}: description.`, "a session holding no increment edits the live record");
  assert.equal((await library.get(form.id))?.fields.description, "Typed here");
});
