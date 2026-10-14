/**
 * Capability 17 · The library's commands: contract 17.1, the `library` family the library declares for the command
 * line, and 17.2, the artifact tools it declares for the MCP server, run with a caller on a fresh project's library on
 * the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "../index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";
import { LIBRARY_FAMILIES, NOTE_TOOLS, type HeldClaim, type LibraryVerbContext, type NoteRead, type NoteToolContext } from "./index.js";

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
  await library.advanceIncrement(increment.id, "active"); // as claiming it does
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
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, undefined, "the live record is left alone");

  const live = await verbOf("edit").act({ "<id>": form.id, "<fields>": { description: "Typed here" } }, contextOf("person:owner"), WORDS);
  assert.equal(live.text, `Edited capability ${form.id}: description.`, "a session holding no increment edits the live record");
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, "Typed here");
});

test("17.2 · The library declares search_notes, open, write_note and correct_note as tools and none as a command; each artifact they show is handed to the door as a read, found as the session last saw it, and an artifact written with no place goes onto the shelf of the capability the session claimed last, inside the cover it opened last", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);

  const tools = NOTE_TOOLS.map((one) => mounted(one.tool) ? one.tool.name : undefined);
  assert.deepEqual(tools, ["search_notes", "open", "write_note", "correct_note"]);
  assert.ok(NOTE_TOOLS.every((one) => !mounted(one.command)), "no tool is a command");
  const toolOf = (name: string): Verb<VerbInputs, NoteToolContext> => NOTE_TOOLS[tools.indexOf(name)]!;

  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const cover = await library.recordDecision({ status: "accepted", title: "Ask for the address once", text: "One field.", frontCoverOf: form.id });
  const reads: NoteRead[] = [];
  const claims: HeldClaim[] = [{ session: "lane", capability: form.id, since: "2026-10-15T00:00:00.000Z" }];
  const context: NoteToolContext = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => claims,
    notesRead: async () => reads,
    recordReads: async (more) => void reads.push(...more),
    presenterOf: async () => undefined,
  };
  const WORDS: DoorWords = { door: "tool", say: (step) => step.tool ?? `storytree ${step.command}` };

  await toolOf("open").act({ id: form.id }, context, WORDS);
  assert.deepEqual(reads, [{ note: cover.id, found: "shelf", read: "peek" }], "a shelf's covers are peeks");
  const opened = await toolOf("open").act({ id: cover.id }, context, WORDS);
  assert.match(opened.text, /^Decision "Ask for the address once"/);
  assert.deepEqual(reads.at(-1), { note: cover.id, found: "shelf", read: "whole" }, "opened whole, found where it was last shown");

  const decided = await toolOf("write_note").act({ kind: "decision", fields: {}, title: "Check the postcode", text: "Before sending.", links: [], term: undefined, meaning: undefined, front_cover_of: undefined }, context, WORDS);
  assert.match(decided.text, new RegExp(`as a front cover of ${form.id}, the capability you hold`));
  const defined = await toolOf("write_note").act({ kind: "definition", fields: {}, term: "Postcode", meaning: "Where the post goes.", links: [], title: undefined, text: undefined, front_cover_of: undefined }, context, WORDS);
  const term = (defined.data as { id: string }).id;
  assert.deepEqual((await library.get(term))?.fields.links, [cover.id], "a definition links inside the cover opened last");

  await assert.rejects(toolOf("write_note").act({ kind: "memory", fields: {}, links: [], title: undefined, text: undefined, term: undefined, meaning: undefined, front_cover_of: undefined }, context, WORDS), VerbRefusal);
});
