// Capability 17 · The library's commands
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { connect } from "../index.js";
import { connect as connectProject } from "../project/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../verbs/verb.js";
import { LIBRARY_FAMILIES, NOTE_TOOLS, type HeldClaim, type LibraryVerbContext, type NoteToolContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("17.1 · The library declares the library family first among storytree's families, its fourteen verbs as commands, then capability 27's three, and none as a tool; a verb reads a phrase from @file in the caller's folder and refile rewrites an artifact as another kind under its id (holding a planned record's edit on the caller's increment is 10.29's)", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-library-verbs-"));
  t.after(async () => {
    await removeTemp(folder);
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
  await library.advanceIncrement(increment.id, "active");
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
  const said = "2 voice.note records are dormant here: their plugin, voice, is not mounted on this computer; mount it with storytree settings set module voice plugin voice.";
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

test("17.29 · library edit <question> --unbuilt records on a settled question the capabilities the owner's answer leaves unbuilt, as a comma-separated list; its wording stays refused", async (t) => {
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
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const story = await library.addStory({ title: "Sign up" });
  const social = await library.addCapability({ story: story.id, title: "Social sign-in" });
  const session = await library.addCapability({ story: story.id, title: "Session" });
  const question = await library.raiseQuestion({ arc: arc.id, title: "Build sign-in?", stakes: "Sign-in", statement: "Build it now?", context: "It is retired", options: "A. Build it. B. Leave it unbuilt." });
  await library.settleQuestion(question.id, { answer: "Just leave it as unbuilt" });

  await edit.act({ "<id>": question.id, "<fields>": { unbuilt: `${social.id},${session.id}` } }, context, WORDS);
  assert.deepEqual(((await library.get(question.id))?.fields as { unbuilt?: string[] } | undefined)?.unbuilt, [social.id, session.id]);
  await assert.rejects(edit.act({ "<id>": question.id, "<fields>": { title: "Build it later?" } }, context, WORDS), VerbRefusal, "its wording stays as answered");
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
  await library.advanceIncrement(increment.id, "active");
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

test("4.62 · library new edge, run by a session holding an increment with a pending retire of an edge, writes that edge's reverse, the retired edge left live; the reverse of an edge with no retire pending is refused as a loop", async (t) => {
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

  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const link = await library.addCapability({ story: story.id, title: "Link" });
  const welcome = await library.addCapability({ story: story.id, title: "Welcome" });
  const old = await library.addEdge({ from: link.id, to: form.id });
  await library.addEdge({ from: welcome.id, to: form.id });
  const arc = await library.createArc({ title: "Reverse the link", intent: "The form reads the link", endState: "The form depends on the link" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Reverse it", objective: "Reverse the link", body: "Red then green" });
  await library.advanceIncrement(increment.id, "active");
  await library.pendChange(increment.id, { record: old.id, retire: "the form depends on the link instead" }, { actor: "session:lane" });
  const context: LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [{ session: "lane", increment: increment.id, since: "2026-11-27T00:00:00.000Z", branch: "claude/reverse-link" }],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };

  const made = await create.act({ "<kind>": "edge", "<fields>": { from: form.id, to: link.id } }, context, WORDS);
  const reversed = /edge (edge_[0-9a-f]{12})/.exec(made.text)?.[1];
  assert.ok(reversed !== undefined, made.text);
  assert.deepEqual((await library.get(reversed))?.fields, { from: form.id, to: link.id });
  assert.deepEqual((await library.get(old.id))?.fields, { from: link.id, to: form.id }, "the retired edge is still live until the branch merges");
  await assert.rejects(
    create.act({ "<kind>": "edge", "<fields>": { from: form.id, to: welcome.id } }, context, WORDS),
    (error: unknown) => error instanceof Error && error.message.includes(`dependency loop between capabilities: ${form.id} → ${welcome.id} → ${form.id}`),
  );
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
  await library.advanceIncrement(increment.id, "active");
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

test("17.20 · library edit's answer for an edit held on the caller's increment says the way out when that increment will have no branch (arc increment drop-pending of that increment and record, then the edit again with --live) in its text, and offers neither as a next step (friction_2c24f3dcea45)", async (t) => {
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
  await library.advanceIncrement(increment.id, "active");
  const context: LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [{ session: "lane", increment: increment.id, since: "2026-11-03T00:00:00.000Z", branch: "claude/address-form" }],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };

  const held = await edit.act({ "<id>": form.id, "<fields>": { description: "Where they type it" }, live: false }, context, WORDS);
  const dropPending = `arc increment drop-pending ${increment.id} ${form.id}`;
  assert.ok(held.text.includes(dropPending) && held.text.includes("--live"), held.text);
  const next = (held.next ?? []).map((step) => step.command ?? "");
  assert.ok(!next.some((command) => command.startsWith("arc increment drop-pending")), JSON.stringify(next));
  assert.ok(!next.some((command) => command.startsWith("library edit") && command.includes("--live")), JSON.stringify(next));
});

test("14.19 · library search --kind arc|increment and search_notes kinds arc|increment rank only that kind, never refusing it", async (t) => {
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
  const term = await library.defineTerm({ term: "Invoice refunds", meaning: "Invoice refunds go out monthly." });
  const arc = await library.createArc({ title: "Invoice refunds", intent: "Invoice refunds are issued.", endState: "Invoice refunds are settled." });
  const increment = await library.addIncrement({ arc: arc.id, title: "Invoice refunds", objective: "Invoice refunds are issued.", body: "Invoice refunds." });
  const context = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }),
    notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined,
  } satisfies LibraryVerbContext & NoteToolContext;
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const search = family.verbs.find((one) => mounted(one.command) && one.command.name === "search") as Verb<VerbInputs, LibraryVerbContext>;
  const searchNotes = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "search_notes") as Verb<VerbInputs, NoteToolContext>;
  const command = async (kind: string[]): Promise<string> => (await search.act({ words: ["invoice", "refunds"], limit: "20", history: false, kind } as never, context, WORDS)).text;
  const tool = async (kinds: string[]): Promise<string[]> =>
    ((await searchNotes.act({ query: "invoice refunds", limit: 20, history: false, kinds } as never, context, WORDS)).data as { notes: { id: string }[] }).notes.map(({ id }) => id);

  const arcs = await command(["arc"]);
  assert.ok(arcs.includes(arc.id) && !arcs.includes(increment.id) && !arcs.includes(term.id), arcs);
  const increments = await command(["increment"]);
  assert.ok(increments.includes(increment.id) && !increments.includes(arc.id) && !increments.includes(term.id), increments);
  assert.deepEqual(await tool(["arc"]), [arc.id]);
  assert.deepEqual(await tool(["increment"]), [increment.id]);
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

async function justifiedWorld(t: { after(fn: () => Promise<void>): void }) {
  const storytree = await connect({ url: testServerUrl() });
  const lower = await connectProject({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    await lower.close();
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const { records } = await lower.openProject(project);
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const toolOf = (name: string): Verb<VerbInputs, NoteToolContext> => NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === name)!;
  const base = { library, project, session: "curator", folder: process.cwd(), writer: { actor: "session:curator" }, claims: async () => [] };
  const context: LibraryVerbContext = { ...base, testedNumbers: async () => ({ tested: [], untested: [] }) };
  const tools: NoteToolContext = { ...base, notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined };
  return { library, records, verbOf, toolOf, context, tools };
}

test("17.34 · library read of a decision lists each link to a decision with its field, its target and its justification on one line, an old-shape one said to have none; library links shows each linking decision's justification beside it; library edit --justifications writes one, and an edit adding a decision link without one is refused naming it", async (t) => {
  const { library, records, verbOf, context } = await justifiedWorld(t);
  const story = await library.addStory({ title: "Mail" });
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "Queue it." });
  const hand = await library.recordDecision({ status: "accepted", title: "Mail by hand", text: "By hand." });
  const log = await library.recordDecision({ status: "accepted", title: "Mail is logged", text: "Log it." });
  const linking = await records.create("decision", {
    status: "accepted", title: "Retries are twice", text: "Retry twice.",
    links: [queue.id, log.id, story.id], supersedes: [hand.id],
    justifications: { [queue.id]: "Follow it for where a retry waits.", [hand.id]: "Retries replace sending by hand." },
  } as never);

  const read = (await verbOf("read").act({ ids: [linking.id], linked: false, field: undefined }, context, WORDS)).text;
  const lines = read.split("\n");
  const block = lines.slice(lines.indexOf("decision links:"));
  assert.ok(lines.includes("decision links:"), `a decision links block:\n${read}`);
  for (const line of [`  links ${queue.id}  Follow it for where a retry waits.`, `  links ${log.id}  (old shape: no justification)`, `  supersedes ${hand.id}  Retries replace sending by hand.`]) {
    assert.ok(block.includes(line), `library read shows ${JSON.stringify(line)}:\n${read}`);
  }
  assert.ok(!block.some((line) => line.includes(story.id) && /^  links /.test(line)), "a link to a story is not a decision link");

  const linked = (await verbOf("links").act({ artifact: queue.id }, context, WORDS)).text;
  const line = linked.split("\n").find((one) => one.includes(linking.id));
  assert.ok(line?.includes("Follow it for where a retry waits."), `library links shows the justification beside the linking decision:\n${linked}`);

  const editing = await library.recordDecision({ status: "accepted", title: "Bounces are dropped", text: "Drop them." });
  const { cursor } = await library.changesSince(0);
  await assert.rejects(verbOf("edit").act({ "<id>": editing.id, "<fields>": { links: queue.id } }, context, WORDS), (error: Error) => error.message.includes("justification") && error.message.includes(queue.id));
  assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");
  await verbOf("edit").act({ "<id>": editing.id, "<fields>": { links: queue.id, justifications: JSON.stringify({ [queue.id]: "Follow it for where a bounce would wait." }) } }, context, WORDS);
  const edited = (await library.get(editing.id))?.fields as { links?: string[]; justifications?: Record<string, string> };
  assert.deepEqual([edited.links, edited.justifications], [[queue.id], { [queue.id]: "Follow it for where a bounce would wait." }]);
});

test("17.35 · The open tool shows each decision a decision links to with its justification on the same line, and in its data; write_note writes a decision's justifications, and refuses a decision linking a decision without one, naming it", async (t) => {
  const { library, toolOf, tools } = await justifiedWorld(t);
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "Queue it." });
  const term = await library.defineTerm({ term: "Retry", meaning: "Sending again." });
  const note = { kind: "decision", fields: {}, title: "Retries are twice", text: "Retry twice.", term: undefined, meaning: undefined, front_cover_of: undefined };

  const { cursor } = await library.changesSince(0);
  await assert.rejects(toolOf("write_note").act({ ...note, links: [queue.id] }, tools, WORDS), (error: Error) => error.message.includes("justification") && error.message.includes(queue.id));
  assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");
  const written = await toolOf("write_note").act({ ...note, links: [queue.id, term.id], justifications: { [queue.id]: "Follow it for where a retry waits." } }, tools, WORDS);
  const id = (written.data as { id: string }).id;
  assert.deepEqual(((await library.get(id))?.fields as { justifications?: unknown }).justifications, { [queue.id]: "Follow it for where a retry waits." });

  const opened = await toolOf("open").act({ id }, tools, WORDS);
  const lines = opened.text.split("\n");
  const queueLine = lines.slice(lines.indexOf("It links to:")).find((line) => line.includes(queue.id));
  assert.ok(queueLine?.endsWith(" — Follow it for where a retry waits."), `the justification beside its target:\n${opened.text}`);
  const linksTo = (opened.data as { linksTo: { id: string; justification?: string }[] }).linksTo;
  assert.deepEqual(linksTo.map(({ id: target, justification }) => [target, justification]), [[queue.id, "Follow it for where a retry waits."], [term.id, undefined]]);
});

test("17.37 · library new and library edit store a one-line field (title, term) without one final line break (\\n or \\r\\n), as a file given with @file ends; a multi-line field such as text keeps it, byte for byte", async (t) => {
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
  const context: LibraryVerbContext = { library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }) };
  const fieldsOf = async (id: string) => (await library.get(id))?.fields as { title?: string; term?: string; text?: string };
  const authority = JSON.stringify({ basis: "agent-derived", scribedBy: "lane", at: "2026-11-04T12:00:00.000Z" });

  await verbOf("new").act({ "<kind>": "decision", "<fields>": { title: "Ship nightly\n", text: "We ship every night.\n", status: "accepted", decided: "2026-11-04", authority } } as never, context, WORDS);
  const [decision] = await library.list("decision");
  assert.deepEqual([decision!.fields.title, (decision!.fields as { text?: string }).text], ["Ship nightly", "We ship every night.\n"], "new drops the title's final \\n and keeps the text's");

  await verbOf("edit").act({ "<id>": decision!.id, "<fields>": { title: "Ship weekly\r\n", text: "We ship every week.\r\n" } }, context, WORDS);
  assert.deepEqual(await fieldsOf(decision!.id).then(({ title, text }) => [title, text]), ["Ship weekly", "We ship every week.\r\n"], "edit drops the title's final \\r\\n and keeps the text's");

  await verbOf("edit").act({ "<id>": decision!.id, "<fields>": { title: "Ship daily\n\n" } }, context, WORDS);
  assert.equal((await fieldsOf(decision!.id)).title, "Ship daily\n", "only one final line break is dropped");

  await verbOf("new").act({ "<kind>": "definition", "<fields>": { term: "Postcode\r\n", meaning: "Where the post goes." } } as never, context, WORDS);
  const [definition] = await library.list("definition");
  assert.equal((definition!.fields as { term?: string }).term, "Postcode", "new drops the term's final \\r\\n");
  await verbOf("edit").act({ "<id>": definition!.id, "<fields>": { term: "Zip code\n" } }, context, WORDS);
  assert.equal((await fieldsOf(definition!.id)).term, "Zip code", "edit drops the term's final \\n");
});

test("17.38 · Given another live session claims a capability, when library new contract, library edit or library retire writes a contract on it, then the command is refused naming the holder's session and the capability, and nothing is written", async (t) => {
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
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const kept = await library.addContract({ capability: form.id, title: "3.1 · Accepts a valid address" });
  const claims = [{ session: "form-lane", capability: form.id, since: "2026-11-24T14:00:00.000Z", holder: "live" as const }];
  const contextOf = (session: string): LibraryVerbContext => ({
    library, project, session, folder: tmpdir(), writer: { actor: `session:${session}` },
    claims: async () => claims,
    testedNumbers: async () => ({ tested: [], untested: [] }),
  });
  const namesHolder = (error: unknown): boolean => error instanceof VerbRefusal && error.message.includes("form-lane") && error.message.includes(form.id);
  const contracts = async (): Promise<string[]> => (await library.list("contract")).map(({ id }) => id);
  const keptHistory = await library.history({ id: kept.id });

  await assert.rejects(verbOf("new").act({ "<kind>": "contract", "<fields>": { capability: form.id, title: "Rejects a blank address" } }, contextOf("other-lane"), WORDS), namesHolder, "a second session's new contract on the claimed capability is refused, naming the holder and the capability");
  assert.deepEqual(await contracts(), [kept.id], "no contract was written");
  await assert.rejects(verbOf("edit").act({ "<id>": kept.id, "<fields>": { title: "3.1 · Accepts any address" } }, contextOf("other-lane"), WORDS), namesHolder, "its edit is refused");
  await assert.rejects(verbOf("retire").act({ id: kept.id, reason: "overtaken" }, contextOf("other-lane"), WORDS), namesHolder, "its retirement is refused");
  assert.deepEqual(await library.history({ id: kept.id }), keptHistory, "the contract was neither edited nor retired");

  const own = await verbOf("new").act({ "<kind>": "contract", "<fields>": { capability: form.id, title: "Rejects a blank address" } }, contextOf("form-lane"), WORDS);
  const made = /contract_[0-9a-f]{12}/.exec(own.text)?.[0];
  assert.deepEqual((await contracts()).sort(), [kept.id, made].sort(), "the holder's own new contract is written");
});

test("17.39 · library new research given --increment and principle given --arc are written with exactly their own fields, no increment or arc stored; library new increment given --arc stores its arc", async (t) => {
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
  const arc = await library.createArc({ title: "Cookie banner", intent: "Ask before tracking", endState: "Visitors choose" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Read the rules", objective: "Know the law", body: "Read, then write it up" });
  const writtenId = (text: string, kind: string): string => new RegExp(`Wrote ${kind} (${kind}_[0-9a-f]{12})\\.`).exec(text)![1]!;

  const research = { title: "Consent rules", description: "What the law asks of a banner", researched: "2026-11-26", findings: "Opt-in before any cookie is set" };
  const note = await create.act({ "<kind>": "research", "<fields>": { ...research, increment: increment.id } }, context, WORDS);
  assert.deepEqual((await library.get(writtenId(note.text, "research")))?.fields, research, "the research note holds its own fields and no increment");

  const principle = { title: "Ask first", description: "Consent comes before tracking", statement: "No cookie before a yes", why: "The law and the visitor's trust", howToApply: "Load trackers only after consent" };
  const rule = await create.act({ "<kind>": "principle", "<fields>": { ...principle, arc: arc.id } }, context, WORDS);
  assert.deepEqual((await library.get(writtenId(rule.text, "principle")))?.fields, principle, "the principle holds its own fields and no arc");

  const parked = await create.act({ "<kind>": "increment", "<fields>": { arc: arc.id, title: "Draw the banner", objective: "Show it", body: "Red then green" } }, context, WORDS);
  assert.equal(((await library.get(writtenId(parked.text, "increment")))?.fields as { arc?: string } | undefined)?.arc, arc.id, "an increment keeps the arc it was given");
});
