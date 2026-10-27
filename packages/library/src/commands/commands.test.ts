/**
 * Capability 17 · The library's commands: contract 17.1, the `library` family the library declares for the command
 * line, and 17.2, the artifact tools it declares for the MCP server, run with a caller on a fresh project's library on
 * the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "../index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";
import { LIBRARY_FAMILIES, NOTE_TOOLS, type HeldClaim, type LibraryVerbContext, type NoteRead, type NoteToolContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("17.1 · The library declares the library family first among storytree's families, its thirteen verbs as commands, then capability 27's three, and none as a tool; a verb reads a phrase from @file in the caller's folder, refile rewrites an artifact as another kind under its id, and edit run by a session holding an increment holds a planned record's change on it", async (t) => {
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

  const family = LIBRARY_FAMILIES.find((one) => one.name === "library");
  assert.equal(family!.order, 1);
  const names = family!.verbs.map((one) => mounted(one.command) ? one.command.name : undefined);
  assert.deepEqual(names.slice(0, 13), ["search", "phrase", "links", "related", "new", "read", "edit", "refile", "retire", "list", "history", "revert", "undo"], "its own thirteen first, capability 27's after them");
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

  const refiled = await verbOf("refile").act({ "<id>": held.id, "<kind>": "research", "<fields>": { title: "Analytics", description: "Services compared", researched: "2026-10-02", findings: "Plausible counts pages without cookies" } }, contextOf("person:owner"), WORDS);
  assert.equal(refiled.text, `Refiled ${held.id} as research.`);
  assert.deepEqual(await library.get(held.id).then((record) => [record?.type, (record?.fields as { findings?: string } | undefined)?.findings]), ["research", "Plausible counts pages without cookies"], "it reads as research under the same id");
  await assert.rejects(verbOf("refile").act({ "<id>": held.id, "<kind>": "friction", "<fields>": {} }, contextOf("person:owner"), WORDS), VerbRefusal, "a friction report is not refiled into");

  const pended = await verbOf("edit").act({ "<id>": form.id, "<fields>": { description: "Where they type it" } }, contextOf("lane"), WORDS);
  assert.match(pended.text, new RegExp(`pending on increment ${increment.id}`));
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, undefined, "the live record is left alone");

  const live = await verbOf("edit").act({ "<id>": form.id, "<fields>": { description: "Typed here" } }, contextOf("person:owner"), WORDS);
  assert.equal(live.text, `Edited capability ${form.id}: description.`, "a session holding no increment edits the live record");
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, "Typed here");
  const formSeqs = (await library.history({ id: form.id })).map((entry) => entry.seq);
  await assert.rejects(
    verbOf("revert").act({ id: form.id, to: String(formSeqs[0]), read: String(formSeqs.at(-1)), reason: undefined }, contextOf("lane"), WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message.includes(increment.id),
    "a revert of a planned record cannot wait on the increment, so the session holding one is refused",
  );
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, "Typed here", "the live record is left alone");
});

test("17.3 · library edit project-anchor --what … --audience … writes the project's anchor, making it on its first write and refusing any other field with nothing written, and library read reads it back; a story takes no audience (ADR-1085 D1, ADR-1096)", async (t) => {
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
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const context: LibraryVerbContext = { library, project, session: "person:owner", folder: tmpdir(), writer: { actor: "person:owner" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const edit = (id: string, fields: Record<string, string>) => verbOf("edit").act({ "<id>": id, "<fields>": fields }, context, WORDS);

  await assert.rejects(edit("project-anchor", { what: "a shop builder", title: "Shop" }), VerbRefusal);
  assert.deepEqual(await library.history({ id: "project-anchor" }), [], "nothing was written");
  await edit("project-anchor", { what: "a shop builder" });
  await edit("project-anchor", { audience: "small shops" });
  assert.deepEqual(await library.anchor(), { what: "a shop builder", audience: "small shops" });
  const read = await verbOf("read").act({ ids: ["project-anchor"], linked: false, field: undefined } as never, context, WORDS);
  assert.match(read.text, /what: a shop builder/);
  assert.match(read.text, /audience: small shops/);

  const stories = await library.list("story");
  await assert.rejects(verbOf("new").act({ "<kind>": "story", "<fields>": { title: "Owner sees orders", audience: "shop owners" } } as never, context, WORDS));
  assert.deepEqual(await library.list("story"), stories, "no story was written");
});

test("17.5 · library edit pr-cutover --at … --repository … writes the repository cut-over, the old repository by default the name's -history and none when it was deleted; it is refused without both, or with another field, with nothing written (increment_7f7599b35fe4)", async (t) => {
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
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const context: LibraryVerbContext = { library, project, session: "person:owner", folder: tmpdir(), writer: { actor: "person:owner" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const edit = (fields: Record<string, string>) => verbOf("edit").act({ "<id>": "pr-cutover", "<fields>": fields }, context, WORDS);

  await assert.rejects(edit({ at: "2026-11-02T09:00:00Z" }), VerbRefusal, "no repository");
  await assert.rejects(edit({ at: "2026-11-02T09:00:00Z", repository: "storytree-ai/storytree", title: "Flip" }), VerbRefusal, "no such field");
  assert.deepEqual(await library.history({ id: "pr-cutover" }), [], "nothing was written");
  const made = await edit({ at: "2026-11-02T09:00:00Z", repository: "storytree-ai/storytree" });
  assert.match(made.text, /before 2026-11-02T09:00:00Z are storytree-ai\/storytree-history's; later ones are storytree-ai\/storytree's/);
  assert.deepEqual(await library.prCutover(), { at: "2026-11-02T09:00:00Z", repository: "storytree-ai/storytree", before: "storytree-ai/storytree-history" });
  await edit({ before: "none" });
  assert.deepEqual(await library.prCutover(), { at: "2026-11-02T09:00:00Z", repository: "storytree-ai/storytree", before: null }, "a deleted old repository");
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
  assert.deepEqual(((await library.get(term))?.fields as { links?: string[] } | undefined)?.links, [cover.id], "a definition links inside the cover opened last");

  await assert.rejects(toolOf("write_note").act({ kind: "memory", fields: {}, links: [], title: undefined, text: undefined, term: undefined, meaning: undefined, front_cover_of: undefined }, context, WORDS), VerbRefusal);
});

test("17.4 · One field round-trips byte for byte: library read --field and the open tool's field give a record's stored value exactly, and library edit @file writes it back unchanged", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-library-field-"));
  t.after(async () => {
    rmSync(folder, { recursive: true, force: true });
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const toolOf = (name: string): Verb<VerbInputs, NoteToolContext> => NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === name)!;
  const base = { library, project, session: "curator", folder, writer: { actor: "session:curator" }, claims: async () => [] };
  const context: LibraryVerbContext = { ...base, testedNumbers: async () => ({ tested: [], untested: [] }) };
  const reads: NoteRead[] = [];
  const tools: NoteToolContext = { ...base, notesRead: async () => reads, recordReads: async (more) => void reads.push(...more), presenterOf: async () => undefined };

  const text = "  D1. The owner's call: it isn’t ‘settled’ yet.\r\n\n\tIndented, with \"quotes\" and a trailing space \n\n";
  const decision = await library.recordDecision({ status: "accepted", title: "Exact words", text });
  const read = await verbOf("read").act({ ids: [decision.id], linked: false, field: "text" }, context, WORDS);
  assert.deepEqual([read.text, read.raw], [text, true], "the command line prints the stored value raw");
  const opened = await toolOf("open").act({ id: decision.id, field: "text" }, tools, WORDS);
  assert.equal(opened.text, text, "the open tool gives the same value");
  assert.deepEqual(reads.at(-1), { note: decision.id, found: "id", read: "whole" }, "reading a field reads the artifact");

  const file = path.join(folder, "text.txt");
  writeFileSync(file, read.text);
  const edited = readFileSync(file, "utf8").replace("isn’t", "is not");
  writeFileSync(file, edited);
  await verbOf("edit").act({ "<id>": decision.id, "<fields>": { text: readFileSync(file, "utf8") } }, context, WORDS); // as the door reads `--text @text.txt`
  const back = await verbOf("read").act({ ids: [decision.id], linked: false, field: "text" }, context, WORDS);
  assert.equal(back.text, edited, "the edited file comes back byte for byte");

  await assert.rejects(toolOf("open").act({ id: decision.id, field: "answer" }, tools, WORDS), (error: unknown) => error instanceof VerbRefusal && /"answer".*\btext\b/.test(error.message));
});

test("17.6 · library read says a record of a plugin's kind no mounted plugin declares is dormant, and reads it as stored; with the plugin mounted it reads as any other record (ADR-1178 D3)", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const note = { kind: "voice.note", version: 1, fields: { type: "object", properties: { words: { type: "string" } }, required: ["words"] }, writers: ["storytree_voice"] };
  const withPlugin = await storytree.openProject(project, { kinds: [note] });
  const written = await withPlugin.createPluginRecord("voice.note", { words: "park the globe idea" });
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const read = family.verbs.find((one) => mounted(one.command) && one.command.name === "read")! as Verb<VerbInputs, LibraryVerbContext>;
  const readIn = async (library: typeof withPlugin) => (await read.act({ ids: [written.id], linked: false, field: undefined } as never, {
    library, project, session: "curator", folder: tmpdir(), writer: { actor: "session:curator" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }),
  }, WORDS)).text;

  const live = await readIn(withPlugin);
  assert.match(live, /words: park the globe idea/);
  assert.doesNotMatch(live, /dormant/);
  const dormant = await readIn(await storytree.openProject(project));
  assert.match(dormant.split("\n")[0]!, /\[voice\.note\]  schema 1  dormant: its plugin is not mounted on this computer$/);
  assert.match(dormant, /words: park the globe idea/, "read as stored");
});

test("17.7 · The open tool opens a record of a plugin's kind whole, as library read does, said dormant when no mounted plugin declares it (ADR-1178 D3)", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const note = { kind: "voice.note", version: 1, fields: { type: "object", properties: { words: { type: "string" } }, required: ["words"] }, writers: ["storytree_voice"] };
  const withPlugin = await storytree.openProject(project, { kinds: [note] });
  const written = await withPlugin.createPluginRecord("voice.note", { words: "park the globe idea" });
  const open = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "open")! as Verb<VerbInputs, NoteToolContext>;
  const openIn = async (library: typeof withPlugin) => (await open.act({ id: written.id, field: undefined } as never, {
    library, project, session: "curator", folder: tmpdir(), writer: { actor: "session:curator" }, claims: async () => [],
    notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined,
  }, WORDS)).text;

  const live = await openIn(withPlugin);
  assert.match(live.split("\n")[0]!, /\[voice\.note\]  schema 1$/);
  assert.match(live, /words: park the globe idea/);
  const dormant = await openIn(await storytree.openProject(project));
  assert.match(dormant.split("\n")[0]!, /\[voice\.note\]  schema 1  dormant: its plugin is not mounted on this computer$/);
  assert.match(dormant, /words: park the globe idea/, "read as stored");
});

test("17.8 · library revert writes a record back to an entry library history shows, whole and under its id, bringing a retired one back; the entry names what it reverted to and who, and a revert read before a later write is refused with nothing written", async (t) => {
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
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const context: LibraryVerbContext = { library, project, session: "curator", folder: tmpdir(), writer: { actor: "session:curator" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const seqs = async (id: string): Promise<number[]> => (await library.history({ id })).map((entry) => entry.seq);

  const decision = await library.recordDecision({ status: "accepted", title: "Kept words", text: "D1. The first wording." });
  await verbOf("edit").act({ "<id>": decision.id, "<fields>": { text: "D1. A bad rewrite." } }, context, WORDS);
  await verbOf("retire").act({ id: decision.id, reason: "thought overtaken" }, context, WORDS);
  const [first, , retired] = await seqs(decision.id);
  const shown = await verbOf("history").act({ id: decision.id, fields: false }, context, WORDS);
  assert.match(shown.text, new RegExp(`\\b${first}\\b.*created`), "history shows the entry to revert to");

  assert.equal(verbOf("revert").writes, true, "a door runs it as a write, handing it the session as writer");
  const done = await verbOf("revert").act({ id: decision.id, to: String(first), read: String(retired), reason: "the retirement was a mistake" }, context, WORDS);
  assert.match(done.text, new RegExp(`${decision.id}.*${first}`));
  const back = await library.get(decision.id);
  assert.deepEqual(back?.fields, decision.fields, "live again under its id, as first written");
  const last = (await library.history({ id: decision.id })).at(-1)!;
  assert.deepEqual([last.action, last.actor, last.reason], ["updated", "session:curator", `reverted to ${first}: the retirement was a mistake`]);

  await library.recordDecision({ status: "accepted", title: "Another", text: "D1. Unrelated." });
  const before = await library.history();
  await assert.rejects(
    verbOf("revert").act({ id: decision.id, to: String(first), read: String(retired), reason: undefined }, context, WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message.includes(String(last.seq)),
    "a curator who read before the revert is refused, told the newest entry",
  );
  await assert.rejects(verbOf("revert").act({ id: decision.id, to: "first", read: String(last.seq), reason: undefined }, context, WORDS), VerbRefusal);
  assert.deepEqual(await library.history(), before, "nothing was written");
});

test("17.9 · library undo <actor> writes every record one writer wrote back to before that writer's first write, retiring what it made; where another writer wrote since, it is refused naming the record, with nothing written", async (t) => {
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
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const context: LibraryVerbContext = { library, project, session: "curator", folder: tmpdir(), writer: { actor: "session:curator" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const bob = { actor: "session:bob" };
  const meaning = async (id: string): Promise<unknown> => ((await library.get(id))?.fields as { meaning?: string } | undefined)?.meaning;

  const decision = await library.recordDecision({ status: "accepted", title: "Kept words", text: "D1. The first wording." });
  const term = await library.defineTerm({ term: "Kept", meaning: "First meaning." });
  await library.editNote(decision.id, { text: "D1. A bad rewrite." }, bob);
  await library.retire(term.id, "thought overtaken", bob);
  const made = await library.defineTerm({ term: "Bob's", meaning: "New." }, bob);
  const other = await library.defineTerm({ term: "Other", meaning: "Before." });
  await library.editNote(other.id, { meaning: "Dan's meaning." }, { actor: "session:dan" });
  await library.editNote(other.id, { meaning: "Mended since." }, { actor: "session:cat" });
  const before = await library.history();

  assert.equal(verbOf("undo").writes, true, "a door runs it as a write, handing it the session as writer");
  await assert.rejects(
    verbOf("undo").act({ actor: "session:dan", reason: undefined }, context, WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message.includes(other.id) && error.message.includes("session:cat"),
    "refused, naming the record another writer wrote since, and who",
  );
  assert.deepEqual(await library.history(), before, "nothing was written");
  assert.equal(await meaning(other.id), "Mended since.");

  const story = await library.addStory({ title: "Bob's story" }, bob);
  const holding: LibraryVerbContext = { ...context, claims: async () => [{ session: "curator", increment: "increment_000000000001", since: "2026-10-27T00:00:00.000Z" }] };
  await assert.rejects(
    verbOf("undo").act({ actor: "session:bob", reason: undefined }, holding, WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message.includes(story.id),
    "a session holding an increment cannot undo a planned record live",
  );
  assert.deepEqual((await library.history()).length, before.length + 1, "nothing was written");

  const done = await verbOf("undo").act({ actor: "session:bob", reason: "bob was misled" }, context, WORDS);
  assert.match(done.text, new RegExp(`Reverted 4 records session:bob wrote[^]*${made.id}  retired`));
  assert.equal(((await library.get(decision.id))?.fields as { text?: string } | undefined)?.text, "D1. The first wording.");
  assert.equal(await meaning(term.id), "First meaning.", "a record bob retired is live again");
  assert.equal(await library.get(made.id), null, "a record bob made is retired");
  assert.equal(await library.get(story.id), null);
  const kept = await library.history({ id: decision.id });
  assert.deepEqual([kept.at(-1)!.actor, kept.at(-1)!.reason], ["session:curator", `reverted session:bob's writes, to ${kept[0]!.seq}: bob was misled`]);
  assert.match((await verbOf("undo").act({ actor: "session:nobody", reason: undefined }, context, WORDS)).text, /session:nobody wrote nothing to revert/);
});

test("17.10 · The library declares the fyi family: fyi new records an FYI, by the caller unless --by names another, fyi list lists the unheard ones oldest first, and fyi heard marks them heard so the list no longer shows them; none is a tool (ADR-1184 D3)", async (t) => {
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
  const family = LIBRARY_FAMILIES.find((one) => one.name === "fyi");
  assert.ok(family, "the fyi family is declared");
  assert.ok(family.verbs.every((one) => !mounted(one.tool)), "no verb is a tool");
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const context: LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };

  assert.equal((await verbOf("list").act({}, context, WORDS)).text, "No FYIs waiting to be heard.");
  const made = await verbOf("new").act({ title: "The exemptions list changed", what: "Two paths were added", about: "PR #31", at: "2026-10-27T09:00:00.000Z", by: undefined }, context, WORDS);
  const id = /fyi_[0-9a-f]{12}/.exec(made.text)?.[0];
  assert.ok(id, made.text);
  assert.equal(((await library.get(id))?.fields as { by?: string } | undefined)?.by, "session:lane", "written by the caller");
  await verbOf("new").act({ title: "A routine was paused", what: "The nightly sweep is off", about: "process_000000000001", at: "2026-10-26T09:00:00.000Z", by: "routine:sweep" }, context, WORDS);

  const listed = (await verbOf("list").act({}, context, WORDS)).text;
  assert.ok(listed.indexOf("A routine was paused") < listed.indexOf("The exemptions list changed"), listed);
  assert.match(listed, /PR #31/);

  const heard = await verbOf("heard").act({ ids: [id] }, context, WORDS);
  assert.match(heard.text, new RegExp(`Marked heard: ${id}`));
  const after = (await verbOf("list").act({}, context, WORDS)).text;
  assert.doesNotMatch(after, /The exemptions list changed/);
  assert.match(after, /A routine was paused/);
  await assert.rejects(verbOf("heard").act({ ids: ["fyi_000000000000"] }, context, WORDS), VerbRefusal);
});
