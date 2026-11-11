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
import { connect as connectProject } from "../project/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";
import { RECENT_MS, refuseStaleEdit } from "./stale-edit.js";
import { LIBRARY_FAMILIES, NOTE_TOOLS, type HeldClaim, type LibraryVerbContext, type NoteRead, type NoteToolContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("17.1 · The library declares the library family first among storytree's families, its fourteen verbs as commands, then capability 27's three, and none as a tool; a verb reads a phrase from @file in the caller's folder and refile rewrites an artifact as another kind under its id (holding a planned record's edit on the caller's increment is 10.29's)", async (t) => {
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
  assert.deepEqual(names.slice(0, 14), ["search", "phrase", "exact", "links", "related", "new", "read", "edit", "refile", "retire", "list", "history", "revert", "undo"], "its own fourteen first, capability 27's after them");
  assert.ok(family!.verbs.every((one) => !mounted(one.tool)), "no verb is a tool");
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family!.verbs[names.indexOf(name)]!;

  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Rename it", body: "Red then green" });
  await library.advanceIncrement(increment.id, "active"); // as claiming it does
  const claims: HeldClaim[] = [{ session: "lane", increment: increment.id, since: "2026-10-15T00:00:00.000Z", branch: "claude/address-form" }, { session: "library-lane", increment: increment.id, since: "2026-10-15T00:00:00.000Z" }];
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

  await verbOf("edit").act({ "<id>": form.id, "<fields>": { description: "Typed here" } }, contextOf("person:owner"), WORDS);
  const formSeqs = (await library.history({ id: form.id })).map((entry) => entry.seq);
  await assert.rejects(
    verbOf("revert").act({ id: form.id, to: String(formSeqs[0]), read: String(formSeqs.at(-1)), reason: undefined }, contextOf("lane"), WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message.includes(increment.id),
    "a revert of a planned record cannot wait on the increment, so the session holding one is refused",
  );
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, "Typed here", "the live record is left alone");
  await verbOf("revert").act({ id: form.id, to: String(formSeqs[0]), read: String(formSeqs.at(-1)), reason: undefined }, contextOf("library-lane"), WORDS);
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, undefined, "an increment claimed on no branch has nothing to merge, so its session's revert is made live");
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

test("17.2 · The library declares search_notes, find_text, open, write_note and correct_note as tools and none as a command; each artifact they show is handed to the door as a read, found as the session last saw it, and an artifact written with no place goes onto the shelf of the capability the session claimed last, inside the cover it opened last", async (t) => {
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
  assert.deepEqual(tools, ["search_notes", "find_text", "open", "write_note", "correct_note"]);
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

test("17.26 · write_note files a decision on no guessed part: a part in links is refused naming front_cover_of, and two held parts with none named is refused asking which", async (t) => {
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
  const write = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "write_note")!;
  const story = await library.addStory({ title: "Context service" });
  const packets = await library.addCapability({ story: story.id, title: "4 · Packet compilation" });
  const api = await library.addCapability({ story: story.id, title: "5 · HTTP API" });
  const claims: HeldClaim[] = [
    { session: "lane", capability: packets.id, since: "2026-11-11T15:00:00.000Z" },
    { session: "lane", capability: api.id, since: "2026-11-11T15:01:00.000Z" },
  ];
  const context: NoteToolContext = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => claims, notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined,
  };
  const note = { kind: "decision", fields: {}, title: "No cache", text: "Compile each packet fresh.", term: undefined, meaning: undefined, front_cover_of: undefined };

  await assert.rejects(write.act({ ...note, links: [packets.id] }, context, WORDS), (error: Error) => error instanceof VerbRefusal && /"links" takes notes, not parts\. To file this decision on "4 · Packet compilation", pass front_cover_of: capability_/.test(error.message), "a part in links names the field that files a decision on it");
  await assert.rejects(write.act({ ...note, links: [] }, context, WORDS), (error: Error) => error instanceof VerbRefusal && /You hold 2 parts, "4 · Packet compilation" \(capability_\w+\) and "5 · HTTP API" \(capability_\w+\), and named none: give front_cover_of/.test(error.message), "two held parts are not guessed between");
  assert.deepEqual(await library.frontCovers(api.id), [], "nothing was filed on a guessed part");
  const filed = await write.act({ ...note, links: [], front_cover_of: packets.id }, context, WORDS);
  assert.deepEqual((await library.frontCovers(packets.id)).map(({ id }) => id), [(filed.data as { id: string }).id]);
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

test("17.14 · library list, search, phrase and exact say how many records of a plugin's kind no mounted plugin declares the library holds, that they are dormant here, and the command that mounts the plugin, or that this computer's factory has no such plugin; with it mounted, nothing changes (ADR-1178 D3)", async (t) => {
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
  for (const words of ["park the globe idea", "keep the globe"]) await withPlugin.createPluginRecord("voice.note", { words });
  await withPlugin.defineTerm({ term: "Globe", meaning: "the world drawn round" });
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string) => family.verbs.find((one) => mounted(one.command) && one.command.name === name)! as Verb<VerbInputs, LibraryVerbContext>;
  const contextOf = (library: typeof withPlugin, inFactory?: boolean): LibraryVerbContext => ({
    library, project, session: "curator", folder: tmpdir(), writer: { actor: "session:curator" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }),
    ...(inFactory === undefined ? {} : { pluginInFactory: async (plugin: string) => inFactory && plugin === "voice" }),
  });
  const said = "2 voice.note records are dormant here: their plugin, voice, is not mounted on this computer; mount it with storytree settings set part voice plugin voice.";
  const unmounted = await storytree.openProject(project);
  const here = contextOf(unmounted, true);

  for (const all of [false, true]) {
    const listed = await verbOf("list").act({ kind: "voice.note", where: [], all } as never, here, WORDS);
    assert.equal(listed.text, said, `list ${all ? "--all " : ""}names the kind, the count and the mount command`);
  }
  const searched = await verbOf("search").act({ words: ["globe"], limit: undefined } as never, here, WORDS);
  assert.ok(searched.text.split("\n").includes(said), searched.text);
  await assert.rejects(
    verbOf("phrase").act({ phrase: ["globe"], kind: ["voice.note"], field: [], limit: undefined, after: undefined } as never, here, WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message === said,
  );
  await assert.rejects(
    verbOf("exact").act({ phrase: ["globe"], kind: ["voice.note"], field: [] } as never, here, WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message === said,
  );
  const absent = await verbOf("list").act({ kind: "voice.note", where: [], all: false } as never, contextOf(unmounted, false), WORDS);
  assert.equal(absent.text, "2 voice.note records are dormant here: their plugin, voice, is not mounted on this computer; voice is not in this computer's factory, so it cannot be mounted here.");
  assert.doesNotMatch(searched.text, /keep the globe/, "bodies stay hidden");

  const live = contextOf(withPlugin, true);
  const listed = await verbOf("list").act({ kind: "voice.note", where: [], all: false } as never, live, WORDS);
  assert.match(listed.text, /^2 voice\.note records:/);
  assert.doesNotMatch(listed.text, /dormant/);
  assert.doesNotMatch((await verbOf("search").act({ words: ["globe"], limit: undefined } as never, live, WORDS)).text, /dormant/);
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
  const holding: LibraryVerbContext = { ...context, claims: async () => [{ session: "curator", increment: "increment_000000000001", since: "2026-10-27T00:00:00.000Z", branch: "claude/curation" }] };
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

test("17.11 · library history shows, under each write made after its session read outside text, what was read", async (t) => {
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
  const history = family.verbs.find((one) => mounted(one.command) && one.command.name === "history")!;
  const context: LibraryVerbContext = { library, project, session: "curator", folder: tmpdir(), writer: { actor: "session:curator" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };

  const decision = await library.recordDecision({ status: "accepted", title: "Kept words", text: "D1. The first wording." },
    { actor: "session:lane", outsideRead: async () => ["gh pr view 12", "WebFetch https://example.com/post"] });
  await library.editNote(decision.id, { text: "D1. Reworded by a session that read nothing outside." }, { actor: "session:other" });

  const shown = (await history.act({ id: decision.id, fields: false }, context, WORDS)).text.split("\n");
  const created = shown.findIndex((line) => line.includes("created"));
  assert.match(shown[created + 1]!, /read outside text first: gh pr view 12; WebFetch https:\/\/example\.com\/post/, "under the marked write, what its session had read");
  assert.equal(shown.filter((line) => line.includes("read outside text")).length, 1, "the unmarked edit shows none");
});

test("17.12 · library edit --remove <field> removes an optional field, keeping the record and its other fields; a field the kind requires, one also given a value, or one on a story, capability or contract is refused with nothing written", async (t) => {
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
  const edit = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "edit")!;
  const context: LibraryVerbContext = { library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const fieldsOf = async (id: string) => (await library.get(id))?.fields as Record<string, unknown> | undefined;

  const routine = { description: "A routine", statement: "S", trigger: "When due", steps: "1. Do it", surfaces: "The box", failureModes: "None" };
  const check = await library.writeKnowledge("process", { ...routine, title: "Check the backups", schedule: "every day", timeZone: "UTC" });
  const removed = await edit.act({ "<id>": check.id, "<fields>": { trigger: "When the owner asks" }, remove: ["schedule", "timeZone"] }, context, WORDS);
  assert.equal(removed.text, `Edited process ${check.id}: trigger, removed schedule, timeZone.`);
  const after = await fieldsOf(check.id);
  assert.deepEqual([after?.schedule, after?.timeZone, after?.trigger, after?.title], [undefined, undefined, "When the owner asks", "Check the backups"], "its schedule is gone and the rest kept");
  assert.ok(!Object.hasOwn(after ?? {}, "schedule"), "the field is removed, not blanked");

  const refused = async (input: { fields?: Record<string, string>; remove: string[]; id?: string }, said: RegExp) => {
    const id = input.id ?? check.id;
    const before = (await library.history({ id })).length;
    await assert.rejects(edit.act({ "<id>": id, "<fields>": input.fields ?? {}, remove: input.remove }, context, WORDS), (error: unknown) => error instanceof Error && said.test(error.message));
    assert.equal((await library.history({ id })).length, before, "nothing is written");
  };
  await refused({ remove: ["title"] }, /title/);
  await refused({ fields: { trigger: "Daily" }, remove: ["trigger"] }, /--trigger.*--remove trigger|both/);
  const story = await library.addStory({ title: "Sign up", description: "Visitors sign up" });
  await refused({ id: story.id, remove: ["description"] }, /story/);
});

test("17.13 · library new capability, run by a session holding an increment, judges the story's capability numbers as that increment's pending changes would leave it: a number a pending move out of the story or a pending retirement frees is given, and one a pending move into the story brings is refused", async (t) => {
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
  const create = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "new")!;

  const host = await library.addStory({ title: "Factory host" });
  const updates = await library.addStory({ title: "Factory updates" });
  const running = await library.addCapability({ story: host.id, title: "1 · Keeping the host running" });
  await library.addCapability({ story: host.id, title: "2 · Reading the logs" });
  const old = await library.addCapability({ story: host.id, title: "3 · Rotating the logs" });
  const current = await library.addCapability({ story: updates.id, title: "1 · Keeping the factory current" });
  const arc = await library.createArc({ title: "Split the host", intent: "Move running out", endState: "Each story holds its own" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Move running", objective: "Split it", body: "Red then green" });
  await library.advanceIncrement(increment.id, "active"); // as claiming it does
  const writer = { actor: "session:lane" };
  await library.pendChange(increment.id, { record: running.id, fields: { story: updates.id, title: "2 · Keeping the host running" } }, writer);
  await library.pendChange(increment.id, { record: old.id, retire: "folded into reading the logs" }, writer);
  await library.pendChange(increment.id, { record: current.id, fields: { story: host.id, title: "4 · Keeping the factory current" } }, writer);
  const contextOf = (session: string): LibraryVerbContext => ({
    library, project, session, folder: tmpdir(), writer: { actor: `session:${session}` },
    claims: async () => [{ session: "lane", increment: increment.id, since: "2026-10-31T00:00:00.000Z", branch: "claude/swap-forms" }],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  });
  const titleOf = async (text: string) => ((await library.get(/capability_[0-9a-f]{12}/.exec(text)![0]))?.fields as { title: string }).title;

  const freed = await create.act({ "<kind>": "capability", "<fields>": { story: host.id, title: "1 · Heavy runs" } }, contextOf("lane"), WORDS);
  assert.equal(await titleOf(freed.text), "1 · Heavy runs", "the number the pending move frees is given");
  const retired = await create.act({ "<kind>": "capability", "<fields>": { story: host.id, title: "3 · Coverage" } }, contextOf("lane"), WORDS);
  assert.equal(await titleOf(retired.text), "3 · Coverage", "the number the pending retirement frees is given");
  await assert.rejects(
    create.act({ "<kind>": "capability", "<fields>": { story: host.id, title: "4 · The test ratio" } }, contextOf("lane"), WORDS),
    (error: unknown) => error instanceof Error && error.message.includes(`capability number 4 is taken: ${current.id}`) && error.message.includes("next free number is 5"),
    "the number a pending move brings into the story is taken",
  );
  const next = await create.act({ "<kind>": "capability", "<fields>": { story: host.id, title: "The test ratio" } }, contextOf("lane"), WORDS);
  assert.equal(await titleOf(next.text), "5 · The test ratio", "the next free number is past the one moving in");
  await assert.rejects(
    create.act({ "<kind>": "capability", "<fields>": { story: updates.id, title: "2 · Watching the factory" } }, contextOf("lane"), WORDS),
    (error: unknown) => error instanceof Error && error.message.includes(`capability number 2 is taken: ${running.id}`),
    "the number the pending move takes in the story it moves to is taken there",
  );
  assert.equal(((await library.get(running.id))?.fields as { story: string }).story, host.id, "the live plan is unchanged");
});

test("17.15 · library list --where on a list field matches the records whose list holds the value, and --open keeps only open increments (proposal or active), so one call finds the open increments that name a capability; --open on another kind is refused", async (t) => {
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
  const story = await library.addStory({ title: "Sign up" });
  const [form, mailer] = [await library.addCapability({ story: story.id, title: "Form" }), await library.addCapability({ story: story.id, title: "Mailer" })];
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const work = { arc: arc.id, objective: "Do it", body: "Red then green" };
  const both = await library.addIncrement({ ...work, title: "Both", capabilities: [form.id, mailer.id] });
  // A second open increment on a capability is listed by an edit, since parking it would be refused (10.35).
  const onlyMailer = await library.addIncrement({ ...work, title: "Only the mailer" });
  await library.editIncrement(onlyMailer.id, { capabilities: [mailer.id] });
  const done = await library.addIncrement({ ...work, title: "Done", capabilities: [form.id], outcome: { pr: "#1", disposition: "landed" } });
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const list = family.verbs.find((one) => mounted(one.command) && one.command.name === "list")! as Verb<VerbInputs, LibraryVerbContext>;
  const context: LibraryVerbContext = { library, project, session: "curator", folder: tmpdir(), writer: { actor: "session:curator" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const run = async (inputs: { kind: string; where: string[]; all?: boolean; open?: boolean }) => (await list.act({ all: false, open: false, ...inputs } as never, context, WORDS)).text;

  const naming = await run({ kind: "increment", where: [`capabilities=${form.id}`] });
  assert.ok(naming.includes(both.id) && naming.includes(done.id), naming);
  assert.ok(!naming.includes(onlyMailer.id), naming);
  const open = await run({ kind: "increment", where: [`capabilities=${form.id}`], open: true });
  assert.ok(open.includes(both.id), open);
  assert.ok(!open.includes(done.id), "a closed increment is not open work");
  const whole = await run({ kind: "increment", where: [`capabilities=${JSON.stringify([mailer.id])}`] });
  assert.ok(whole.includes(onlyMailer.id) && !whole.includes(both.id), "a whole list still matches the list it equals");
  await assert.rejects(run({ kind: "decision", where: [], open: true }), (error: unknown) => error instanceof VerbRefusal && /--open/.test(error.message));
});

test("17.16 · library edit --live, run by a session holding an increment, edits a story, capability or contract live, writing no pending change on the increment, so the session corrects the live plan without letting its increment go (ADR-0966 D1's note)", async (t) => {
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
  const edit = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "edit")!;
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const mail = await library.addCapability({ story: story.id, title: "Mail" });
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Rename it", body: "Red then green" });
  await library.advanceIncrement(increment.id, "active"); // as claiming it does
  const context: LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [{ session: "lane", increment: increment.id, since: "2026-11-03T00:00:00.000Z", branch: "claude/address-form" }],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };
  const pendingOf = async () => ((await library.get(increment.id))?.fields as { pending?: unknown[] }).pending ?? [];

  const live = await edit.act({ "<id>": form.id, "<fields>": { dependsOn: mail.id }, live: true }, context, WORDS);
  assert.doesNotMatch(live.text, /pending/, live.text);
  assert.deepEqual(await library.dependsOn(form.id), [mail.id], "the live capability is edited");
  assert.deepEqual(await pendingOf(), [], "nothing waits on the increment");

  await edit.act({ "<id>": form.id, "<fields>": { description: "Where they type it" }, live: false }, context, WORDS);
  assert.equal((await pendingOf()).length, 1, "without --live the edit still waits on the increment");
});

test("17.20 · library edit's answer for an edit held on the caller's increment names the way out when that increment will have no branch: arc increment drop-pending of that increment and record, then the edit again with --live, also given as its next steps (friction_f02365572601)", async (t) => {
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
  const edit = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "edit")!;
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Redo the form's plan", objective: "Redo it", body: "Library only" });
  await library.advanceIncrement(increment.id, "active"); // as claiming it does
  const context: LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [{ session: "lane", increment: increment.id, since: "2026-11-03T00:00:00.000Z", branch: "claude/address-form" }],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };

  const held = await edit.act({ "<id>": form.id, "<fields>": { description: "Where they type it" }, live: false }, context, WORDS);
  const dropPending = `arc increment drop-pending ${increment.id} ${form.id}`;
  assert.ok(held.text.includes(dropPending) && held.text.includes("--live"), held.text);
  const next = (held.next ?? []).map((step) => step.command ?? "");
  assert.ok(next.some((command) => command.startsWith(dropPending)), JSON.stringify(next));
  assert.ok(next.some((command) => command.startsWith(`library edit ${form.id}`) && command.includes("--live")), JSON.stringify(next));
});

test("17.17 · library exact and the find_text tool list every live record holding a phrase exactly, each with its id, kind, title and the fields that hold it, following the cursor to the end", async (t) => {
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
  const exact = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "exact")!;
  const findText = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "find_text")!;
  const reads: NoteRead[] = [];
  const context: NoteToolContext & LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [],
    testedNumbers: async () => ({ tested: [], untested: [] }),
    notesRead: async () => reads,
    recordReads: async (more) => void reads.push(...more),
    presenterOf: async () => undefined,
  };

  const link = "README.md#keys";
  const term = await library.defineTerm({ term: "Keys", meaning: `See ${link} for the keys.` });
  const arc = await library.createArc({ title: "Docs", intent: "Move headings", endState: "Links work" });
  const increment = await library.addIncrement({ arc: arc.id, title: `Repoint ${link}`, objective: "Repoint", body: `Every ${link} moves.` });
  await library.defineTerm({ term: "Other case", meaning: "See readme.md#keys." });
  // More than one page of the store's: only following the cursor reaches them all.
  const stories = [];
  for (let n = 0; n < 101; n += 1) stories.push(await library.addStory({ title: `Story ${n} at ${link}` }));
  const every = [term.id, increment.id, ...stories.map((story) => story.id)];

  const listed = await exact.act({ phrase: [link], kind: [], field: [] }, context, WORDS);
  assert.match(listed.text, /^103 records hold "README\.md#keys" exactly:/);
  for (const id of every) assert.ok(listed.text.includes(id), `${id} is listed`);
  assert.match(listed.text, new RegExp(`${term.id}  \\[definition\\]  Keys  \\(meaning\\)`), "a record's line names the field that holds it");
  assert.match(listed.text, new RegExp(`${increment.id}  \\[increment\\]  Repoint README\\.md#keys  \\(body, title\\)`));

  const titled = await exact.act({ phrase: [link], kind: ["increment", "definition"], field: ["title"] }, context, WORDS);
  assert.match(titled.text, /^1 record holds "README\.md#keys" exactly:/);
  assert.ok(titled.text.includes(increment.id) && !titled.text.includes(term.id), "kinds and fields narrow the sweep");
  assert.match((await exact.act({ phrase: ["no such words"], kind: [], field: [] }, context, WORDS)).text, /^No record holds "no such words" exactly\./);
  await assert.rejects(exact.act({ phrase: ["README.md", "#keys"], kind: [], field: [] }, context, WORDS), (error: unknown) => error instanceof VerbRefusal && /one argument/.test(error.message), "a phrase the shell split is refused, not joined");

  const found = await findText.act({ phrase: link, kinds: [], fields: [] }, context, WORDS);
  assert.deepEqual((found.data as { records: { id: string }[] }).records.map((record) => record.id).sort(), [...every].sort(), "the tool follows the cursor too");
  assert.deepEqual((found.data as { records: { id: string; fields: string[] }[] }).records.find((record) => record.id === increment.id)?.fields, ["body", "title"]);
  assert.equal(reads.length, 103, "each record the tool shows is a peek");
  assert.ok(reads.every((read) => read.found === "search" && read.read === "peek"));
});

test("17.24 · library search and search_notes give current state unless told: --history (history) brings back resteers, friction and superseded decisions, --kind (kinds) ranks only the kinds named, an unknown kind is refused as misuse, and a narrowed decision's line names the decision that narrows it", async (t) => {
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
  const old = await library.recordDecision({ status: "accepted", title: "Mapped is grey", text: "Mapped islands are grey." });
  await library.recordDecision({ status: "accepted", title: "Grey for parked", text: "Parked islands are grey, and mapped ones are not.", supersedes: [old.id] });
  const narrowed = await library.recordDecision({ status: "accepted", title: "Mapped is brown", text: "Mapped islands are brown." });
  const narrowing = await library.recordDecision({ status: "accepted", title: "Explored islands take their health", text: "Only unexplored mapped islands stay brown.", narrows: [narrowed.id] });
  const resteer = await library.writeKnowledge("resteer", {
    title: "Mapped islands are not grey", description: "Redirected.", doing: "Painting mapped islands", redirect: "Not grey", evidence: "He said so.", disposition: "taste", dispositionBy: "owner",
  });
  const reads: NoteRead[] = [];
  const context = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }),
    notesRead: async () => reads, recordReads: async (more: readonly NoteRead[]) => void reads.push(...more), presenterOf: async () => undefined,
  } satisfies LibraryVerbContext & NoteToolContext;
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const search = family.verbs.find((one) => mounted(one.command) && one.command.name === "search") as Verb<VerbInputs, LibraryVerbContext>;
  const searchNotes = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "search_notes") as Verb<VerbInputs, NoteToolContext>;
  const command = async (inputs: object): Promise<string> => (await search.act({ words: ["mapped", "islands"], limit: "20", history: false, kind: [], ...inputs } as never, context, WORDS)).text;
  const tool = async (inputs: object): Promise<{ id: string; narrowedBy?: unknown }[]> =>
    ((await searchNotes.act({ query: "mapped islands", limit: 20, history: false, kinds: [], ...inputs } as never, context, WORDS)).data as { notes: { id: string; narrowedBy?: unknown }[] }).notes;

  const current = await command({});
  assert.ok(current.includes(narrowed.id) && current.includes(narrowing.id), current);
  assert.ok(!current.includes(old.id) && !current.includes(resteer.id), "a superseded decision and a resteer are history");
  assert.match(current, new RegExp(`${narrowed.id}  \\[decision\\]  Mapped is brown.*\\(narrowed by ADR-${String(narrowing.fields.number).padStart(4, "0")}\\)`));
  const all = await command({ history: true });
  assert.ok(all.includes(old.id) && all.includes(resteer.id), all);
  const resteers = await command({ kind: ["resteer"] });
  assert.ok(resteers.includes(resteer.id) && !resteers.includes(narrowed.id), resteers);
  await assert.rejects(command({ kind: ["arc"] }), (error: unknown) => error instanceof VerbRefusal && /arc is not a kind a search ranks/.test(error.message));

  assert.deepEqual(new Set((await tool({})).map(({ id }) => id)), new Set([narrowed.id, narrowing.id, (await library.decision(old.id))!.supersededBy[0]]));
  assert.deepEqual((await tool({})).find(({ id }) => id === narrowed.id)?.narrowedBy, [{ id: narrowing.id, number: narrowing.fields.number }]);
  assert.ok((await tool({ history: true })).some(({ id }) => id === resteer.id));
  assert.deepEqual((await tool({ kinds: ["resteer"] })).map(({ id }) => id), [resteer.id]);
});

test("17.19 · library new decision refuses an accepted decision with no authority, with nothing written, naming adr new; with an authority it writes it (friction_b2b343a7a75e)", async (t) => {
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
  const create = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "new")!;
  const context: LibraryVerbContext = { library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const decision = { title: "Ship nightly", text: "We ship every night.", status: "accepted", decided: "2026-11-04" };

  await assert.rejects(create.act({ "<kind>": "decision", "<fields>": decision } as never, context, WORDS), (error: unknown) => error instanceof VerbRefusal && /authority/.test(error.message) && /adr new/.test(error.message));
  assert.deepEqual(await library.list("decision"), [], "no decision was written");

  const authority = JSON.stringify({ basis: "agent-derived", scribedBy: "lane", at: "2026-11-04T12:00:00.000Z" });
  const written = await create.act({ "<kind>": "decision", "<fields>": { ...decision, authority } } as never, context, WORDS);
  const [stored] = await library.list("decision");
  assert.match(written.text, new RegExp(`Wrote decision ${stored!.id}`));
  assert.equal((stored!.fields as { authority?: { basis: string } }).authority?.basis, "agent-derived", "its authority is stored");
});

test("17.21 · library edit and correct_note refuse, naming the newer change and writing nothing, a whole-field write whose record changed since --read <seq>, or, with no --read, that another writer changed in the last 15 minutes (friction_90ff039d8cce)", async (t) => {
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
  const edit = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "edit")!;
  const correct = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "correct_note")!;
  const contextOf = (session: string): LibraryVerbContext => ({ library, project, session, folder: tmpdir(), writer: { actor: `session:${session}` }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) });
  const toolContextOf = (session: string): NoteToolContext => ({ ...contextOf(session), notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined });
  const newest = async (id: string) => (await library.history({ id })).at(-1)!.seq;
  const stepsOf = async (id: string) => ((await library.get(id))?.fields as { steps?: string } | undefined)?.steps;

  const routine = { title: "Land a pull request", description: "A routine", statement: "S", trigger: "When green", steps: "1. Push", surfaces: "The box", failureModes: "None" };
  const process = await library.writeKnowledge("process", routine);
  await edit.act({ "<id>": process.id, "<fields>": { steps: "1. Push\n2. Hand over" } }, contextOf("A"), WORDS);
  await edit.act({ "<id>": process.id, "<fields>": { steps: "1. Push\n2. Hand over\n3. Close out" } }, contextOf("A"), WORDS); // its own last change
  const theirs = await newest(process.id);

  const refused = async (input: Record<string, unknown>, context: LibraryVerbContext | NoteToolContext, verb: typeof edit | typeof correct, id: string) => {
    const before = await newest(id);
    await assert.rejects(verb.act(input as never, context as never, WORDS), (error: unknown) => error instanceof VerbRefusal && error.message.includes(`entry ${before}`) && error.message.includes("session:A"));
    assert.equal(await newest(id), before, "nothing is written");
  };
  await refused({ "<id>": process.id, "<fields>": { steps: "1. Push\n2. Wait" } }, contextOf("B"), edit, process.id);
  await refused({ "<id>": process.id, "<fields>": { steps: "1. Push\n2. Wait" }, read: String(theirs - 1) }, contextOf("B"), edit, process.id);
  assert.equal(await stepsOf(process.id), "1. Push\n2. Hand over\n3. Close out", "A's steps stand");
  await edit.act({ "<id>": process.id, "<fields>": { steps: "1. Push\n2. Hand over\n3. Close out\n4. Debrief" }, read: String(theirs) }, contextOf("B"), WORDS);
  assert.equal(await stepsOf(process.id), "1. Push\n2. Hand over\n3. Close out\n4. Debrief", "re-read and re-applied, it writes");

  const term = await library.defineTerm({ term: "Lane", meaning: "A session the pool starts." });
  await correct.act({ id: term.id, meaning: "A session the pool starts on the box." } as never, toolContextOf("A"), WORDS);
  await refused({ id: term.id, meaning: "A worker." }, toolContextOf("B"), correct, term.id);
  await correct.act({ id: term.id, meaning: "A session the pool starts on the Mint box.", read: String(await newest(term.id)) } as never, toolContextOf("B"), WORDS);
  assert.equal(((await library.get(term.id))?.fields as { meaning?: string } | undefined)?.meaning, "A session the pool starts on the Mint box.");

  await assert.rejects(edit.act({ "<id>": term.id, "<fields>": { meaning: "A worker." }, read: "latest" }, contextOf("B"), WORDS), (error: unknown) => error instanceof VerbRefusal && error.misuse === true, "a --read that is no entry's seq");
  await refuseStaleEdit(library, term.id, { actor: "session:A" }, undefined, Date.now() + RECENT_MS + 1000); // B's change, read or not, is older than the window
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  await edit.act({ "<id>": form.id, "<fields>": { description: "Typed here" } }, contextOf("A"), WORDS);
  await edit.act({ "<id>": form.id, "<fields>": { description: "Typed there" } }, contextOf("B"), WORDS);
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, "Typed there", "a planned record's edit is held with the entry it read, not refused here");
});

test("17.22 · library new edge and library new contract --edge write an edge and its contract, library edit corrects an edge's description, library read of a capability gives its dependsOn as the plan's tree does, and library move-to-edges moves stored same-story dependsOn ids onto edges", async (t) => {
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
  const verbs = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs;
  const verbOf = (name: string) => verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const context: LibraryVerbContext = {
    library, project, session: "person:owner", folder: tmpdir(), writer: { actor: "person:owner" },
    claims: async () => [],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const link = await library.addCapability({ story: story.id, title: "Link" });

  const made = await verbOf("new").act({ "<kind>": "edge", "<fields>": { from: link.id, to: form.id, description: "Reads the form" } }, context, WORDS);
  const edge = /edge (edge_[0-9a-f]{12})/.exec(made.text)?.[1];
  assert.ok(edge !== undefined, made.text);
  const contract = await verbOf("new").act({ "<kind>": "contract", "<fields>": { edge, title: "The link reads the form's address" } }, context, WORDS);
  assert.match(contract.text, /Wrote contract contract_/);
  await verbOf("edit").act({ "<id>": edge, "<fields>": { description: "Reads the form's address" }, live: false }, context, WORDS);
  const tree = await library.projectTree();
  assert.deepEqual(tree.stories[0]!.edges?.map(({ id, description, contracts }) => ({ id, description, contracts: contracts.map(({ title }) => title) })), [
    { id: edge, description: "Reads the form's address", contracts: ["2.1 · The link reads the form's address"] },
  ]);

  const read = await verbOf("read").act({ ids: [link.id], linked: false, field: "dependsOn", out: undefined }, context, WORDS);
  assert.deepEqual(JSON.parse(read.text), [form.id], "a capability's dependsOn reads its edge");

  // A link stored before edges, written around the work model, is moved onto an edge.
  const mail = await library.addCapability({ story: story.id, title: "Mail" });
  const lower = await connectProject({ url: testServerUrl() });
  try {
    await (await lower.openProject(project)).records.edit(mail.id, { dependsOn: [form.id] });
  } finally {
    await lower.close();
  }
  const moved = await verbOf("move-to-edges").act({}, context, WORDS);
  assert.match(moved.text, /Moved 1 link onto edges, from 1 capability/);
  assert.deepEqual(await library.dependsOn(mail.id), [form.id]);
  assert.match((await verbOf("move-to-edges").act({}, context, WORDS)).text, /nothing to move/);
});


test("17.27 · library edit --edge moving a contract onto a link that leaves its part with no live contracts of its own names that part and says to plan its own behaviour contract or leave it bare knowingly; a move that leaves it contracts says nothing of it", async (t) => {
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
  const edit = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "edit")!;
  const context: LibraryVerbContext = {
    library, project, session: "person:owner", folder: tmpdir(), writer: { actor: "person:owner" },
    claims: async () => [],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };
  const story = await library.addStory({ title: "Context service" });
  const identity = await library.addCapability({ story: story.id, title: "Caller identity" });
  const api = await library.addCapability({ story: story.id, title: "HTTP API" });
  const edge = await library.addEdge({ from: api.id, to: identity.id });
  const unknown = await library.addContract({ capability: identity.id, title: "Unknown user gets no content" });
  const known = await library.addContract({ capability: identity.id, title: "Known user gets their content" });

  const kept = await edit.act({ "<id>": unknown.id, "<fields>": { edge: edge.id }, live: false }, context, WORDS);
  assert.equal(kept.text, `Edited contract ${unknown.id}: edge.`, "a part left a contract of its own is said nothing of");
  const bare = await edit.act({ "<id>": known.id, "<fields>": { edge: edge.id }, live: false }, context, WORDS);
  assert.equal(bare.text, `Edited contract ${known.id}: edge. "1 · Caller identity" (${identity.id}) now has no contracts of its own: plan its own behaviour contract (library new contract --capability ${identity.id} --title <title>), or leave it bare knowingly.`);
});

test("17.23 · The open tool opens a contract on an edge whole, as it does a capability's: its title, its statement, the edge and the two capabilities it joins, and its health (increment_fb8e17883110)", async (t) => {
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
  const open = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "open")!;
  const context: NoteToolContext = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => [],
    notesRead: async () => [],
    recordReads: async () => undefined,
    presenterOf: async () => undefined,
  };
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const link = await library.addCapability({ story: story.id, title: "Link" });
  const edge = await library.addEdge({ from: link.id, to: form.id });
  const contract = await library.addContract({ edge: edge.id, title: "The link reads the form's address", description: "It reads the address the form saved." });

  const opened = await open.act({ id: contract.id }, context, WORDS);
  assert.match(opened.text, /^Contract "2\.1 · The link reads the form's address"/);
  assert.match(opened.text, /It reads the address the form saved\./);
  assert.match(opened.text, new RegExp(`It sits on the edge ${edge.id}: Capability "${link.fields.title}" \\(${link.id}\\) depends on Capability "${form.fields.title}" \\(${form.id}\\)\\.`));
  assert.match(opened.text, /Health: verified not-checked, reported not-checked\./);
  assert.deepEqual((opened.data as { contract: { edge: unknown } }).contract.edge, { id: edge.id, from: { id: link.id, title: link.fields.title }, to: { id: form.id, title: form.fields.title } });
});

test("17.25 · The open tool reads a question with an Evidence line naming each record it links by title, after Holding, or as no longer live once retired, and none when it links nothing", async (t) => {
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
  const open = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "open")!;
  const context: NoteToolContext = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => [],
    notesRead: async () => [],
    recordReads: async () => undefined,
    presenterOf: async () => undefined,
  };
  const arc = await library.createArc({ title: "Launch", intent: "Ship it", endState: "It is live" });
  const research = await library.recordDecision({ status: "accepted", title: "Mailgun's API is the simplest", text: "Measured." });
  const ask = { arc: arc.id, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" };
  const question = await library.raiseQuestion({ ...ask, links: [research.id] });
  const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "Steps.", heldOn: [question.id] });

  const opened = await open.act({ id: question.id }, context, WORDS);
  assert.match(opened.text, new RegExp(`Holding: ${increment.id}\\nEvidence: Mailgun's API is the simplest \\[${research.id}\\]$`));
  const plain = await library.raiseQuestion(ask);
  assert.doesNotMatch((await open.act({ id: plain.id }, context, WORDS)).text, /Evidence/);
  await library.retire(research.id, "overtaken");
  assert.match((await open.act({ id: question.id }, context, WORDS)).text, new RegExp(`Evidence: ${research.id} \\(no longer live\\)$`), "a link whose record was retired says so");
});
