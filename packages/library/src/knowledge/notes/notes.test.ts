// Capability 6 · Notes
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { LIBRARY_FAMILIES, NOTE_TOOLS, type LibraryVerbContext, type NoteToolContext } from "../../commands/index.js";
import { connect } from "../../index.js";
import { testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../../verbs/verb.js";
import { ARTIFACT_KINDS, type HeldClaim, type NoteRead } from "../index.js";
import { narrowedSaid } from "./ranked.js";
import { RECENT_MS, refuseStaleEdit } from "./stale-edit.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

async function justifiedWorld(t: { after(fn: () => Promise<void>): void }) {
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
  const toolOf = (name: string): Verb<VerbInputs, NoteToolContext> => NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === name)!;
  const base = { library, project, session: "curator", folder: process.cwd(), writer: { actor: "session:curator" }, claims: async () => [] };
  const context: LibraryVerbContext = { ...base, testedNumbers: async () => ({ tested: [], untested: [] }) };
  const tools: NoteToolContext = { ...base, notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined };
  return { library, verbOf, toolOf, context, tools };
}

test("6.36 · The library declares search_notes, find_text, open, write_note and correct_note as tools and none as a command; each artifact they show is handed to the door as a read, found as the session last saw it, and an artifact written with no place goes onto the shelf of the capability the session claimed last, inside the cover it opened last", async (t) => {
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

  const pattern = { title: "A window's end treated as inclusive", description: "Found by the CI harvest", instance: { run: 7, test: "2.1 · totals" }, caughtAt: "ci", reasoning: "It passed only once its pull request changed the window" };
  const escaped = await toolOf("write_note").act({ kind: "escape", fields: pattern, links: [], title: undefined, text: undefined, term: undefined, meaning: undefined, front_cover_of: undefined }, context, WORDS);
  assert.deepEqual(await library.get((escaped.data as { id: string }).id).then((record) => [record?.type, (record?.fields as { caughtAt?: string } | undefined)?.caughtAt]), ["escape", "ci"], "an escape pattern is written through the door");
  const create = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "new")!;
  const made = await create.act({ "<kind>": "escape", "<fields>": { ...pattern, title: "A retry counted as a pass", instance: JSON.stringify({ run: 8, test: "2.2 · retries" }) } }, { ...context, testedNumbers: async () => ({ tested: [], untested: [] }) }, WORDS);
  assert.match(made.text, /^Wrote escape escape_[0-9a-f]{12}\./, "and through library new");
  const narrowed = await toolOf("search_notes").act({ query: "retry counted as a pass", limit: undefined, history: false, kinds: ["escape"], projects: undefined }, context, WORDS);
  assert.match(narrowed.text, /A retry counted as a pass/, "a search narrows to escape patterns");
  const layers = ["test-writer", "builder", "lint", "tests", "mutation", "test-reviewer", "code-reviewer", "ci-linux", "ci-windows"].map((layer) => ({ layer, result: ["test-writer", "builder", "ci-windows"].includes(layer) ? "not-run" : "missed", evidence: `${layer} ran on the scratch branch and said nothing` }));
  const drill = { title: "Drill: a retry tallied twice", description: "The window pattern replanted in the retry tally", pattern: (escaped.data as { id: string }).id, plant: { story: story.id, capability: form.id, file: "packages/form/src/tally.ts", shape: "a retry's end counted as inside its window" }, mode: "defect", layers, caughtBy: "none", fixer: "escaped", session: "red-team-lane", date: "2026-11-18" };
  await toolOf("write_note").act({ kind: "drill", fields: drill, links: [], title: undefined, text: undefined, term: undefined, meaning: undefined, front_cover_of: undefined }, context, WORDS);
  const drills = await toolOf("search_notes").act({ query: "retry tallied", limit: undefined, history: false, kinds: ["drill"], projects: undefined }, context, WORDS);
  assert.match(drills.text, /Drill: a retry tallied twice/, "a red-team drill is written through the door, and a search narrows to drills");
  assert.doesNotMatch(drills.text, /A retry counted as a pass/, "and finds no escape pattern there");
  const measure = { title: "Sign-up form submit time", description: "How long the form takes to answer a submit", story: story.id, reads: "the milliseconds from submit to the answer shown", unit: "ms", better: "lower", howRead: "submit the form ten times and take the median", machine: "the Mint box", runs: 10, version: 1 };
  const measured = await toolOf("write_note").act({ kind: "measure", fields: measure, links: [], title: undefined, text: undefined, term: undefined, meaning: undefined, front_cover_of: undefined }, context, WORDS);
  const measuredId = (measured.data as { id: string }).id;
  assert.deepEqual(await library.get(measuredId).then((record) => [record?.type, record?.fields]), ["measure", { ...measure, links: [] }], "a measure is written through the door, with the links it was given");
  const madeMeasure = await create.act({ "<kind>": "measure", "<fields>": { ...measure, title: "Sign-up form field count", reads: "the fields the form shows", unit: "fields", better: "neither", runs: "1", version: "2" } }, { ...context, testedNumbers: async () => ({ tested: [], untested: [] }) }, WORDS);
  assert.match(madeMeasure.text, /^Wrote measure measure_[0-9a-f]{12}\./, "and through library new, its runs and version given as words");
  const madeId = /measure_[0-9a-f]{12}/.exec(madeMeasure.text)![0];
  const madeFields = (await library.get(madeId))?.fields as { runs?: unknown; version?: unknown } | undefined;
  assert.deepEqual([madeFields?.runs, madeFields?.version], [1, 2], "read as whole numbers");
  const measures = await toolOf("search_notes").act({ query: "sign-up form", limit: undefined, history: false, kinds: ["measure"], projects: undefined }, context, WORDS);
  assert.match(measures.text, /Sign-up form submit time/, "a search narrows to measures");
  assert.doesNotMatch(measures.text, /Drill: a retry tallied twice|A retry counted as a pass/, "and finds no other kind there");
  assert.deepEqual((await library.measures(story.id)).map(({ id }) => id), [measuredId, madeId], "the library lists the story's measures, oldest first");
});

test("6.37 · One field round-trips byte for byte: library read --field and the open tool's field give a record's stored value exactly, and library edit @file writes it back unchanged", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-library-field-"));
  t.after(async () => {
    await removeTemp(folder);
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
  await verbOf("edit").act({ "<id>": decision.id, "<fields>": { text: readFileSync(file, "utf8") } }, context, WORDS);
  const back = await verbOf("read").act({ ids: [decision.id], linked: false, field: "text" }, context, WORDS);
  assert.equal(back.text, edited, "the edited file comes back byte for byte");

  await assert.rejects(toolOf("open").act({ id: decision.id, field: "answer" }, tools, WORDS), (error: unknown) => error instanceof VerbRefusal && /"answer".*\btext\b/.test(error.message));
});

test("6.38 · The open tool opens a record of a plugin's kind whole, as library read does, said dormant when no mounted plugin declares it (ADR-1178 D3)", async (t) => {
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

test("6.39 · library exact and the find_text tool list every live record holding a phrase exactly, each with its id, kind, title and the fields that hold it, following the cursor to the end", async (t) => {
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

test("6.40 · library edit and correct_note refuse, naming the newer change and writing nothing, a whole-field write whose record changed since --read <seq>, or, with no --read, that another writer changed in the last 15 minutes (friction_90ff039d8cce)", async (t) => {
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
  await edit.act({ "<id>": process.id, "<fields>": { steps: "1. Push\n2. Hand over\n3. Close out" } }, contextOf("A"), WORDS);
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
  await refuseStaleEdit(library, term.id, { actor: "session:A" }, undefined, Date.now() + RECENT_MS + 1000);
  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  await edit.act({ "<id>": form.id, "<fields>": { description: "Typed here" } }, contextOf("A"), WORDS);
  await edit.act({ "<id>": form.id, "<fields>": { description: "Typed there" } }, contextOf("B"), WORDS);
  assert.equal(((await library.get(form.id))?.fields as { description?: string } | undefined)?.description, "Typed there", "a planned record's edit is held with the entry it read, not refused here");
});

test("6.41 · The open tool opens a contract on an edge whole, as it does a capability's: its title, its statement, the edge and the two capabilities it joins, and its health (increment_fb8e17883110)", async (t) => {
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

test("6.42 · library search and search_notes give current state unless told: --history (history) brings back resteers, friction and superseded decisions, --kind (kinds) ranks only the kinds named, an unknown kind is refused as misuse, and a narrowed decision's line names the decision that narrows it", async (t) => {
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
  await library.recordDecision({ status: "accepted", title: "Grey for parked", text: "Parked islands are grey, and mapped ones are not.", supersedes: [old.id], justifications: { [old.id]: "It replaces the earlier rule." } });
  const narrowed = await library.recordDecision({ status: "accepted", title: "Mapped is brown", text: "Mapped islands are brown." });
  const narrowing = await library.recordDecision({ status: "accepted", title: "Explored islands take their health", text: "Only unexplored mapped islands stay brown.", supersedesClauses: [{ decision: narrowed.id }], justifications: { [narrowed.id]: "It replaces part of the earlier rule." } });
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
  assert.match(current, new RegExp(`${narrowed.id}  \\[decision\\]  Mapped is brown.*\\(partly superseded by ADR-${String(narrowing.fields.number).padStart(4, "0")}\\)`));
  const all = await command({ history: true });
  assert.ok(all.includes(old.id) && all.includes(resteer.id), all);
  const resteers = await command({ kind: ["resteer"] });
  assert.ok(resteers.includes(resteer.id) && !resteers.includes(narrowed.id), resteers);
  await assert.rejects(command({ kind: ["question"] }), (error: unknown) => error instanceof VerbRefusal && /question is not a kind a search ranks/.test(error.message));

  assert.deepEqual(new Set((await tool({})).map(({ id }) => id)), new Set([narrowed.id, narrowing.id, (await library.decision(old.id))!.supersededBy[0]]));
  assert.deepEqual((await tool({})).find(({ id }) => id === narrowed.id)?.narrowedBy, [{ id: narrowing.id, number: narrowing.fields.number }]);
  assert.ok((await tool({ history: true })).some(({ id }) => id === resteer.id));
  assert.deepEqual((await tool({ kinds: ["resteer"] })).map(({ id }) => id), [resteer.id]);
});

test("6.43 · The open tool reads a question with an Evidence line naming each record it links by title, after Holding, or as no longer live once retired, and none when it links nothing", async (t) => {
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

test("6.44 · write_note files a decision on no guessed part: a part in links is refused naming front_cover_of, and two held parts with none named is refused asking which", async (t) => {
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

test("6.45 · A decision filed on a part answers with that part's and each part one link from it on the map: their descriptions and contract titles quoted, a part with none said so, the edit_plan sentence, and nothing of a part two links away", async (t) => {
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
  const api = await library.addCapability({ story: story.id, title: "5 · HTTP API", description: "Serves compiled packets over HTTP." });
  const packets = await library.addCapability({ story: story.id, title: "4 · Packet compilation", description: "Compiles a packet per request; caches packets." });
  const store = await library.addCapability({ story: story.id, title: "3 · Store" });
  const disk = await library.addCapability({ story: story.id, title: "2 · Disk", description: "Writes pages to disk." });
  await library.addEdge({ from: api.id, to: packets.id });
  await library.addEdge({ from: store.id, to: api.id });
  await library.addEdge({ from: packets.id, to: disk.id });
  await library.addContract({ capability: packets.id, title: "4.3 · A packet asked for twice is compiled once" });
  await library.addContract({ capability: api.id, title: "5.1 · GET /packet answers with the packet" });
  const context: NoteToolContext = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => [], notesRead: async () => [], recordReads: async () => {}, presenterOf: async () => undefined,
  };

  const filed = await write.act({ kind: "decision", fields: {}, title: "No cache", text: "Compile each packet fresh.", links: [], term: undefined, meaning: undefined, front_cover_of: api.id }, context, WORDS);
  assert.match(filed.text, /It is filed on "5 · HTTP API" \(capability_\w+\): Serves compiled packets over HTTP\. It has contracts "5\.1 · GET \/packet answers with the packet"\./, "the part filed on, quoted");
  assert.match(filed.text, /"4 · Packet compilation" \(capability_\w+\), which it depends on: Compiles a packet per request; caches packets\. It has contracts "4\.3 · A packet asked for twice is compiled once"\./, "a part it links to, quoted");
  assert.match(filed.text, /"3 · Store" \(capability_\w+\), which depends on it: no description written\. It has no contracts\./, "a part linking to it, with no description, said so");
  assert.match(filed.text, /correct it with edit_plan\./);
  assert.doesNotMatch(filed.text, /Disk|Writes pages/, "a part two links away is not quoted");

  const create = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "new")!;
  const person: LibraryVerbContext = { ...context, testedNumbers: async () => ({ tested: [], untested: [] }) };
  const decision = (on: string) => ({ "<kind>": "decision", "<fields>": { status: "accepted", authority: JSON.stringify({ basis: "agent-derived", scribedBy: "person:owner", at: "2026-11-12T00:00:00.000Z" }), title: "No cache", text: "Fresh.", frontCoverOf: on } });
  const made = await create.act(decision(packets.id), person, WORDS);
  assert.match(made.text, /It is filed on "4 · Packet compilation"[^\n]*\n[^]*"5 · HTTP API" \(capability_\w+\), which depends on it: Serves compiled packets over HTTP\.[^]*"2 · Disk" \(capability_\w+\), which it depends on: Writes pages to disk\.[^]*correct it with `storytree library edit`\./);
  assert.doesNotMatch(made.text, /3 · Store/, "two links away from packets");
  const onStory = await create.act(decision(story.id), person, WORDS);
  assert.match(onStory.text, /It is filed on "Context service" \(story_\w+\): no description written\. It has no contracts\.\nIf this decision/);
});

test("6.46 · library search and read, and the search_notes and open tools, read the factory's library or a project it builds when named, from the factory's folder or a project's, each result under its project; all searches every one, naming one that could not be opened; a project outside is refused (ADR-1348 D2)", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const [factoryName, productName, outsideName] = [uniqueProjectName(), uniqueProjectName(), uniqueProjectName()];
  t.after(async () => {
    try {
      for (const name of [productName, factoryName, outsideName]) await storytree.dropProject(name).catch(() => undefined);
    } finally {
      await storytree.close();
    }
  });
  const factory = await storytree.openProject(factoryName);
  await factory.markFactory();
  const howToWork = await factory.recordDecision({ status: "accepted", title: "Land by pull request", text: "Every change lands by pull request." });
  const product = await storytree.openProject(productName);
  await product.recordFactory(factoryName);
  const sitePlan = await product.recordDecision({ status: "accepted", title: "The site's pages land by pull request", text: "The site lands by pull request too." });
  await storytree.openProject(outsideName);
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const toolOf = (name: string): Verb<VerbInputs, NoteToolContext> => NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === name)!;
  const reads: NoteRead[] = [];
  const contextOf = (library: typeof factory): LibraryVerbContext & NoteToolContext => ({
    library, project: library.name, session: "lane", folder: process.cwd(),
    claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }),
    notesRead: async () => reads, recordReads: async (more) => void reads.push(...more), presenterOf: async () => undefined,
  });
  const fromProduct = contextOf(await storytree.openProject(productName));
  const fromFactory = contextOf(factory);

  const searched = await verbOf("search").act({ words: ["land", "by", "pull", "request"], limit: undefined, history: false, kind: [], project: [productName] }, fromFactory, WORDS);
  assert.match(searched.text, new RegExp(`^project ${productName}:`));
  assert.ok(searched.text.includes(sitePlan.id) && !searched.text.includes(howToWork.id), "the product's decision, not the factory's");
  const read = await verbOf("read").act({ ids: [sitePlan.id], linked: false, field: undefined, out: undefined, project: productName }, fromFactory, WORDS);
  assert.match(read.text, new RegExp(`^project ${productName}:[\\s\\S]*${sitePlan.id}`));
  await assert.rejects(verbOf("read").act({ ids: [sitePlan.id], linked: false, field: undefined, out: undefined, project: undefined }, fromFactory, WORDS), /no record .* in this project/, "named nowhere, it reads the folder's own");

  const all = await verbOf("search").act({ words: ["land", "by", "pull", "request"], limit: undefined, history: false, kind: ["decision"], project: ["all"] }, fromProduct, WORDS);
  const own = all.text.indexOf(`project ${productName}:`);
  const theirs = all.text.indexOf(`project ${factoryName}:`);
  assert.ok(own >= 0 && theirs > own, "its own first, then the factory's");
  assert.ok(all.text.slice(own, theirs).includes(sitePlan.id) && all.text.slice(theirs).includes(howToWork.id), "each result under its project");
  assert.ok(!all.text.includes(outsideName), "a project naming no factory is no part of it");
  const tool = await toolOf("search_notes").act({ query: "land by pull request", limit: undefined, history: false, kinds: ["decision"], projects: [factoryName] }, fromProduct, WORDS);
  assert.deepEqual((tool.data!.notes as { id: string; project: string }[]).map(({ id, project }) => [id, project]), [[howToWork.id, factoryName]]);
  const opened = await toolOf("open").act({ id: howToWork.id, field: undefined, project: factoryName }, fromProduct, WORDS);
  assert.match(opened.text, new RegExp(`^project ${factoryName}:\\n[\\s\\S]*Land by pull request`));
  assert.equal((await toolOf("open").act({ id: howToWork.id, field: "text", project: factoryName }, fromProduct, WORDS)).text, "Every change lands by pull request.", "one field, exactly as stored");
  assert.equal((await verbOf("read").act({ ids: [howToWork.id], linked: false, field: "title", out: undefined, project: factoryName }, fromProduct, WORDS)).text, "Land by pull request");
  assert.ok(!reads.some(({ note }) => note === howToWork.id), "another project's record is no read on this folder's knowledge core");

  await assert.rejects(verbOf("read").act({ ids: [sitePlan.id], linked: false, field: undefined, out: undefined, project: outsideName }, fromProduct, WORDS), (error: unknown) => error instanceof VerbRefusal && error.message.includes(outsideName));
  const shut = { ...fromProduct, library: { ...fromProduct.library, reachAll: async () => [{ project: "elsewhere", unopened: "permission denied for table record" }] } };
  const named = await verbOf("search").act({ words: ["land"], limit: undefined, history: false, kind: [], project: ["all"] }, shut, WORDS);
  assert.match(named.text, /project elsewhere: not read: it could not be opened from this computer: permission denied for table record/);
});

test("6.47 · Every kind ARTIFACT_KINDS registers is ranked by library search --kind; one it marks captured is refused by library new and write_note naming its capture command and tool (friction and resteer only), and any other reaches its writer, refused only for its missing fields", async (t) => {
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
  const reads: NoteRead[] = [];
  const context = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }),
    notesRead: async () => reads, recordReads: async (more: readonly NoteRead[]) => void reads.push(...more), presenterOf: async () => undefined,
  } satisfies LibraryVerbContext & NoteToolContext;
  const family = LIBRARY_FAMILIES.find((one) => one.name === "library")!;
  const verb = (name: string) => family.verbs.find((one) => mounted(one.command) && one.command.name === name) as Verb<VerbInputs, LibraryVerbContext>;
  const writeNote = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "write_note") as Verb<VerbInputs, NoteToolContext>;
  const refusal = (attempt: Promise<unknown>): Promise<string> => attempt.then(() => "written", (error: Error) => error.message);

  assert.deepEqual(
    Object.entries(ARTIFACT_KINDS).filter(([, kind]) => kind.captured !== undefined).map(([name, kind]) => [name, kind.captured]),
    [["friction", { command: "storytree friction new", tool: "record_friction" }], ["resteer", { command: "storytree resteer new", tool: "record_resteer" }]],
  );
  for (const [kind, { captured }] of Object.entries(ARTIFACT_KINDS)) {
    await verb("search").act({ words: ["anything"], limit: undefined, history: false, kind: [kind] } as never, context, WORDS);
    const made = await refusal(verb("new").act({ "<kind>": kind, "<fields>": {} } as never, context, WORDS));
    const noted = await refusal(writeNote.act({ kind, fields: {}, links: [], title: undefined, text: undefined, term: undefined, meaning: undefined, front_cover_of: undefined } as never, context, WORDS));
    if (captured === undefined) {
      assert.ok(made.startsWith(`${kind}: missing required field "title"`), `library new ${kind}: ${made}`);
      assert.equal(noted, `Give the required fields for a ${kind} in fields.`, `write_note ${kind}`);
    } else {
      assert.ok(made.includes(`\`${captured.command}\``), `library new ${kind}: ${made}`);
      assert.ok(noted.includes(captured.tool), `write_note ${kind}: ${noted}`);
    }
  }
  assert.deepEqual(await library.list("principle"), [], "nothing was written");
});

test("6.48 · The open tool and library read, on a story or a capability, list everything attached to it: its covers, a story's capabilities with theirs, the open increments naming it or a capability of the story with the questions holding them, and every other record naming it in a field; a closed increment and a prose mention are not listed", async (t) => {
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
  const open = NOTE_TOOLS.find((one) => mounted(one.tool) && one.tool.name === "open")! as Verb<VerbInputs, NoteToolContext>;
  const read = LIBRARY_FAMILIES.find((one) => one.name === "library")!.verbs.find((one) => mounted(one.command) && one.command.name === "read")! as Verb<VerbInputs, LibraryVerbContext>;
  const toolContext: NoteToolContext = {
    library, project, session: "lane", folder: process.cwd(), writer: { actor: "session:lane" },
    claims: async () => [],
    notesRead: async () => [],
    recordReads: async () => undefined,
    presenterOf: async () => undefined,
  };
  const readContext: LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" }, claims: async () => [], testedNumbers: async () => ({ tested: [], untested: [] }),
  };

  const story = await library.addStory({ title: "Sign up" });
  const form = await library.addCapability({ story: story.id, title: "Form" });
  const link = await library.addCapability({ story: story.id, title: "Confirmation link", dependsOn: [form.id] });
  const storyCover = await library.recordDecision({ status: "accepted", title: "Sign up by email", text: "No passwords.", frontCoverOf: story.id });
  const formCover = await library.recordDecision({ status: "accepted", title: "Ask for the address once", text: "One field.", frontCoverOf: form.id });
  const linkCover = await library.recordDecision({ status: "accepted", title: "The link lasts a day", text: "Then it expires.", frontCoverOf: link.id });
  const contract = await library.addContract({ title: "Rejects a bad email", capability: form.id });
  const prose = await library.recordDecision({ status: "accepted", title: "Mentions both", text: `The story ${story.id} and its form ${form.id}, in prose only.` });
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
  const question = await library.raiseQuestion({ arc: arc.id, title: "Which mailer?", stakes: "s", statement: "q", context: "c", options: "o" });
  const closed = await library.addIncrement({ arc: arc.id, title: "First form", objective: "Done before", body: "Red then green", capabilities: [form.id] });
  await library.advanceIncrement(closed.id, "active");
  await library.closeIncrement(closed.id, { pr: "#1", disposition: "landed" });
  const held = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Build it", body: "Red then green", capabilities: [form.id], heldOn: [question.id] });
  const active = await library.addIncrement({ arc: arc.id, title: "Confirmation mail", objective: "Send it", body: "Red then green", capabilities: [link.id] });
  await library.advanceIncrement(active.id, "active");

  const byId = <T extends { id: string }>(list: readonly T[]): T[] => [...list].sort((one, other) => one.id.localeCompare(other.id));
  type Attached = { shelf: unknown[]; capabilities: { id: string; title: string; shelf: unknown[] }[]; increments: { id: string; title: string; heldOn: string[] }[]; namedBy: { id: string; kind: string; label: string }[] };
  const opened = async (id: string) => {
    const answer = await open.act({ id }, toolContext, WORDS);
    return { text: answer.text, data: answer.data as { shelf: unknown[]; attached: Attached } };
  };

  const edge = (await library.list("edge")).find(({ fields }) => fields.from === link.id && fields.to === form.id)!;
  const ofForm = await opened(form.id);
  const ofLink = await opened(link.id);
  assert.deepEqual(ofForm.data.attached?.shelf, ofForm.data.shelf, "a capability's own covers");
  assert.deepEqual((ofForm.data.attached.shelf as { id: string }[]).map(({ id }) => id), [formCover.id]);
  assert.deepEqual(ofForm.data.attached.capabilities, [], "a capability lists no capabilities");
  assert.deepEqual(ofForm.data.attached.increments, [{ id: held.id, title: "Address form", heldOn: [question.id] }], "the open increment naming it, with the question holding it, and not the closed one");
  assert.deepEqual(byId(ofForm.data.attached.namedBy).map(({ id, kind }) => ({ id, kind })), byId([{ id: contract.id, kind: "contract" }, { id: edge.id, kind: "edge" }]), "the other records naming it in a field, and not the prose mention, its cover or an increment");

  const ofStory = await opened(story.id);
  assert.deepEqual((ofStory.data.attached.shelf as { id: string }[]).map(({ id }) => id), [storyCover.id], "a story's own covers");
  assert.deepEqual(byId(ofStory.data.attached.capabilities), byId([{ id: form.id, title: "1 · Form", shelf: ofForm.data.shelf }, { id: link.id, title: "2 · Confirmation link", shelf: ofLink.data.shelf }]), "each of its capabilities with its covers");
  assert.deepEqual(byId(ofStory.data.attached.increments), byId([{ id: held.id, title: "Address form", heldOn: [question.id] }, { id: active.id, title: "Confirmation mail", heldOn: [] }]), "the open increments naming any of its capabilities");
  const storyNamedBy = ofStory.data.attached.namedBy.map(({ id }) => id);
  assert.ok(storyNamedBy.includes(arc.id), "the arc naming the story in its stories list");
  for (const listedElsewhere of [storyCover.id, held.id, active.id, closed.id, prose.id]) assert.ok(!storyNamedBy.includes(listedElsewhere), listedElsewhere);

  const readText = async (id: string) => (await read.act({ ids: [id], linked: false, field: undefined } as never, readContext, WORDS)).text;
  const shown = [
    { door: "open", part: form.id, text: ofForm.text, attached: [formCover.id, held.id, question.id, contract.id, edge.id] },
    { door: "library read", part: form.id, text: await readText(form.id), attached: [formCover.id, held.id, question.id, contract.id, edge.id] },
    { door: "open", part: story.id, text: ofStory.text, attached: [storyCover.id, form.id, formCover.id, link.id, linkCover.id, held.id, question.id, active.id, arc.id] },
    { door: "library read", part: story.id, text: await readText(story.id), attached: [storyCover.id, form.id, formCover.id, link.id, linkCover.id, held.id, question.id, active.id, arc.id] },
  ];
  for (const { door, part, text, attached } of shown) {
    for (const id of attached) assert.ok(text.includes(id), `${door} ${part} lists ${id}`);
    for (const id of [closed.id, prose.id]) assert.ok(!text.includes(id), `${door} ${part} leaves out ${id}`);
  }
});

test("6.49 · A search hit on a decision superseded in part says so after its title: \"(D2, D3 superseded by ADR-1379)\" with the clauses named, \"(partly superseded by ADR-1379)\" with none", () => {
  assert.equal(narrowedSaid([{ id: "decision_0123456789ab", number: 1379, clauses: ["D2", "D3"] }]), "  (D2, D3 superseded by ADR-1379)");
  assert.equal(narrowedSaid([{ id: "decision_0123456789ab", number: 1379 }]), "  (partly superseded by ADR-1379)");
  assert.equal(narrowedSaid([{ id: "decision_0123456789ab", clauses: ["D4"] }]), "  (D4 superseded by decision_0123456789ab)", "the id stands in for a missing number");
  assert.equal(
    narrowedSaid([{ id: "decision_0123456789ab", number: 7, clauses: ["D1"] }, { id: "decision_ba9876543210" }]),
    "  (D1 superseded by ADR-0007; partly superseded by decision_ba9876543210)",
    "several superseding decisions are joined with a semicolon",
  );
  assert.equal(narrowedSaid([]), "");
});

test("6.50 · library links, library read's \"Linked from:\" and the open tool's \"Linked from:\" list every record linking to a decision, an increment, a question and a friction it discharged beside a note, and not a note citing it only in its text; reading or opening a decision says \"Superseded by ADR-n\" when a later one supersedes it whole and \"Superseded in part by ADR-n (D2, D3)\" when one supersedes those clauses", async (t) => {
  const { library, verbOf, toolOf, context, tools } = await justifiedWorld(t);
  const queue = await library.recordDecision({ status: "accepted", title: "Mail by queue", text: "D1. Queue. D2. Retry. D3. Bounce." });
  const hand = await library.recordDecision({ status: "accepted", title: "Mail by hand", text: "By hand." });
  const topic = await library.recordDecision({ status: "accepted", title: "Mail by topic", text: "Topics replace sending by hand.", supersedes: [hand.id], justifications: { [hand.id]: "It replaces sending by hand." } } as never);
  const retries = await library.recordDecision({ status: "accepted", title: "Retries are twice", text: "Retry twice.", supersedesClauses: [{ decision: queue.id, clauses: ["D2", "D3"] }], justifications: { [queue.id]: "It replaces the queue's retry and bounce rules." } } as never);
  const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Queue the mail", objective: "Build it", body: "Red then green", links: [queue.id] });
  const question = await library.raiseQuestion({ arc: arc.id, title: "Which queue?", stakes: "Mail needs one.", statement: "Which?", context: "Two.", options: "Redis or Postgres.", links: [queue.id] });
  const principle = await library.writeKnowledge("principle", {
    title: "Never send inline", description: "Inline sends block the request.", statement: "Mail leaves through the queue.", why: "Requests stay fast.", howToApply: "Enqueue, never send.", links: [queue.id],
  });
  const friction = await library.writeKnowledge("friction", {
    title: "Mail sent inline", description: "A send blocked sign-up.", statement: "Sign-up waited on the mail server.", evidence: "Sign-up took 9 s.", impact: "Visitors left.",
  });
  await library.editNote(friction.id, { route: "adr", routeReason: "Decided to queue.", dischargedBy: queue.id });
  const citing = await library.writeKnowledge("principle", {
    title: "Mail is cheap", description: "Sending costs little.", statement: `As ${queue.id} says, mail is queued.`, why: "It is.", howToApply: "Send freely.",
  });
  const linking = [increment, question, principle, friction];

  const listed = (await verbOf("links").act({ artifact: queue.id }, context, WORDS)).text;
  const listedLines = listed.split("\n");
  assert.equal(listedLines[0], `4 artifacts link to ${queue.id}:`, listed);
  for (const record of linking) assert.ok(listedLines.some((line) => line.startsWith(`  ${record.id}  [${record.type}]  `)), `library links lists the ${record.type}:\n${listed}`);
  assert.ok(!listed.includes(citing.id), `not the note citing it in its text:\n${listed}`);

  const read = (await verbOf("read").act({ ids: [queue.id], linked: false, field: undefined }, context, WORDS)).text;
  const readLines = read.split("\n");
  assert.ok(readLines.includes("Linked from:"), `library read has a Linked from section:\n${read}`);
  const readFrom = readLines.slice(readLines.indexOf("Linked from:") + 1);
  for (const record of linking) assert.ok(readFrom.some((line) => line.startsWith(`  ${record.id}  [${record.type}]  `)), `library read lists the ${record.type} under Linked from:\n${read}`);
  assert.ok(!read.includes(citing.id), `not the note citing it in its text:\n${read}`);
  assert.ok(readLines.includes("Superseded in part by ADR-0004 (D2, D3)"), `library read names the clause supersession:\n${read}`);
  const readHand = (await verbOf("read").act({ ids: [hand.id], linked: false, field: undefined }, context, WORDS)).text;
  assert.ok(readHand.split("\n").includes("Superseded by ADR-0003"), `library read names the whole supersession:\n${readHand}`);

  const opened = await toolOf("open").act({ id: queue.id }, tools, WORDS);
  const openLines = opened.text.split("\n");
  assert.ok(openLines.includes("Linked from:"), `open has a Linked from section:\n${opened.text}`);
  const openFrom = openLines.slice(openLines.indexOf("Linked from:") + 1);
  for (const record of linking) assert.ok(openFrom.some((line) => line.includes(record.id)), `open lists the ${record.type} under Linked from:\n${opened.text}`);
  assert.deepEqual((opened.data as { linkedFrom: { id: string }[] }).linkedFrom.map(({ id }) => id).sort(), linking.map(({ id }) => id).sort());
  assert.ok(!opened.text.includes(citing.id), `not the note citing it in its text:\n${opened.text}`);
  assert.ok(openLines.includes("Superseded in part by ADR-0004 (D2, D3)"), `open names the clause supersession:\n${opened.text}`);
  const openedHand = (await toolOf("open").act({ id: hand.id }, tools, WORDS)).text;
  assert.ok(openedHand.split("\n").includes("Superseded by ADR-0003"), `open names the whole supersession:\n${openedHand}`);
});
