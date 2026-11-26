// Capability 26 · Rounds
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { quietFor, waitUntil } from "@storytree/test-waits";

import { withTestClient } from "../../../testing/pg.js";
import { healthHistory, withCountedLibrary, withLibrary } from "../testing/pg.js";
import { roundDue, worklist } from "../index.js";
import type { ToolAnswer, ToolCall } from "./host.js";
import { worklistView, type WorklistView } from "./rounds.js";
import { librarianTools } from "./tools.js";

test("26.1 the trigger fires on a write to a curated kind since the session started, and when there is no start; graduation is due either way", async () => {
  await withLibrary(async (library) => {
    const { cursor: start } = await library.changesSince(0);
    await library.writeKnowledge("techstack", { title: "Postgres", description: "Project storage", statement: "Each project uses Postgres.", whatItIs: "A relational database.", whyThis: "Transactional writes and history." });
    assert.deepEqual(await roundDue(library, { since: start }), { graduation: true, rest: false });

    await library.writeKnowledge("principle", { title: "Edit first", description: "Edit before writing new.", statement: "Edit first.", why: "No near-copies.", howToApply: "Search first." });
    assert.deepEqual(await roundDue(library, { since: start }), { graduation: true, rest: true });
    assert.deepEqual(await roundDue(library, {}), { graduation: true, rest: true });
  });
});

test("26.2 the worklist gathers each capability's list: graduation's always, the rest only when the trigger fired, and never the friction drain, which is Friction's", async () => {
  await withLibrary(async (library) => {
    const root = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
    const folder = path.join(root, "memory");
    mkdirSync(folder);
    const memory = path.join(folder, "seed.md");
    writeFileSync(memory, "---\nname: seed\ndescription: Close the app first.\n---\n\nRun the seed with the app closed.\n");
    try {
      const spec = await library.recordDecision({ title: "The MVP spec", text: "One page.", status: "accepted" });
      const { cursor } = await library.changesSince(0);
      const report = { title: "Slow gate", description: "Gate slow", statement: "The gate hangs", evidence: "gate.log: timed out", impact: "A rerun" };
      await library.writeKnowledge("friction", { ...report, provenance: { branch: "claude/other", date: "2026-09-29", source: "retro" } });
      await library.writeKnowledge("techstack", { title: "Postgres", description: "Project storage", statement: "Each project uses Postgres.", whatItIs: "A relational database.", whyThis: "Transactional writes and history." });

      const quiet = await worklist(library, { since: cursor, memoryFolders: [folder] });
      assert.deepEqual(quiet, { graduation: quiet.graduation }, "graduation alone, with no friction drain");
      assert.deepEqual(quiet.graduation.map((item) => item.file), [memory]);

      const fired = await worklist(library, { since: 0, memoryFolders: [folder] });
      assert.deepEqual(fired.graduation.map((item) => item.file), [memory]);
      assert.deepEqual(fired.rest?.links.map((decision) => decision.id), [spec.id]);
      assert.deepEqual(fired.rest?.health, []);
      assert.ok(fired.rest?.catalogue?.some(({ note }) => note.id === spec.id));
      assert.deepEqual(fired.rest?.questions, []);
      assert.deepEqual(Object.keys(fired).sort(), ["graduation", "rest"], "no friction drain");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("26.6 the worklist and land's next-line check take about as much from a library whose history holds weeks of changes, and health piling up since the session started, as from one whose history holds an hour's", { timeout: 120_000 }, async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
  const taken: number[] = [];
  let history = 0;
  try {
    for (const long of [false, true]) {
      await withCountedLibrary(async ({ library, project, received }) => {
        const started = new Date(Date.now() - 2 * 3_600_000);
        if (long) {
          await healthHistory(project, 40_000, new Date(started.getTime() - 3 * 86_400_000));
          history = await healthHistory(project, 4_000, new Date(started.getTime() + 1_000));
        }
        const principle = await library.writeKnowledge("principle", { title: "Edit first", description: "Edit before writing new.", statement: "Edit first.", why: "No near-copies.", howToApply: "Search first." });
        const tools = librarianTools();
        const acts = new Map<string, (args: unknown, call: ToolCall) => Promise<ToolAnswer>>();
        tools.registerTools!((name, _description, _input, act) => {
          acts.set(name, act as unknown as (args: unknown, call: ToolCall) => Promise<ToolAnswer>);
        });
        const call: ToolCall = {
          library, project, folder, writer: {},
          caller: { session: "s-1", harness: "claude-code" },
          log: { lines: async () => [{ kind: "session-started", session: "s-1", harness: "claude-code", at: started.toISOString() }] },
        };
        const before = received();
        assert.equal(await tools.landNext!("capability_x", call), "run the librarian's pass");
        const answer = await acts.get("worklist")!({ memoryFolders: [folder] }, call);
        const listed = answer.data?.worklist as WorklistView;
        assert.deepEqual(listed.rest?.catalogue?.map(({ note }) => note.id), [principle.id], "the note written since the session started, and nothing older");
        taken.push(received() - before);
      });
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  assert.ok(history > 20_000_000, `the long history is weeks' worth: ${history} bytes`);
  assert.ok(taken[1]! - taken[0]! < 128 * 1024, `the calls took ${taken[0]} bytes from a short history and ${taken[1]} from one ${history} bytes longer: no more than 128 KiB apart`);
});

test("26.7 the worklist reads the live notes about once however many notes the session wrote, and with no recorded start leaves the catalogue and related lists unread, saying why, rather than reading every note's history", { timeout: 300_000 }, async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
  const principle = (n: number, title: string) => ({ title, description: `Lesson ${n}`, statement: `Lesson ${n} holds.`, why: `Learned the hard way, ${n}. `.repeat(40), howToApply: "Apply it." });
  try {
    await withCountedLibrary(async ({ library, project, received }) => {
      for (let n = 0; n < 120; n += 1) {
        const note = await library.writeKnowledge("principle", principle(n, `Older lesson number ${n}`));
        await library.editNote(note.id, { statement: `Lesson ${n} holds, edited.` });
      }
      const [last] = await library.history({ newest: 1 });
      const started = new Date(Date.parse(last!.at) + 1);
      await libraryClockPast(started);
      let before = received();
      await library.search("");
      const once = received() - before;

      const tools = librarianTools();
      const acts = new Map<string, (args: unknown, call: ToolCall) => Promise<ToolAnswer>>();
      tools.registerTools!((name, _description, _input, act) => {
        acts.set(name, act as unknown as (args: unknown, call: ToolCall) => Promise<ToolAnswer>);
      });
      const callFor = (start: boolean): ToolCall => ({
        library, project, folder, writer: {},
        caller: { session: "s-1", harness: "claude-code" },
        log: { lines: async () => (start ? [{ kind: "session-started", session: "s-1", harness: "claude-code", at: started.toISOString() }] : []) },
      });
      const take = async (start: boolean): Promise<{ bytes: number; listed: WorklistView }> => {
        before = received();
        const answer = await acts.get("worklist")!({ memoryFolders: [folder] }, callFor(start));
        return { bytes: received() - before, listed: answer.data?.worklist as WorklistView };
      };

      await library.writeKnowledge("principle", principle(1000, "Graduate durable memory every landing"));
      const one = await take(true);
      for (let n = 1001; n < 1008; n += 1) await library.writeKnowledge("principle", principle(n, `Session lesson about worklists, phases and stalls ${n}`));
      const eight = await take(true);
      assert.equal(eight.listed.rest?.counts.catalogue, 8);
      assert.equal(eight.listed.rest?.counts.related, 8);
      assert.ok(eight.bytes - one.bytes < once, `one note written took ${one.bytes} bytes and eight took ${eight.bytes}: no more than one reading of the notes (${once}) apart`);

      const unsure = await take(false);
      assert.equal(unsure.listed.rest?.catalogue, undefined);
      assert.equal(unsure.listed.rest?.related, undefined);
      assert.match(unsure.listed.rest?.unread ?? "", /no session start/i);
      assert.ok(Array.isArray(unsure.listed.rest?.links) && Array.isArray(unsure.listed.rest?.health) && Array.isArray(unsure.listed.rest?.questions), "every other list is still gathered");
      assert.ok(unsure.bytes < eight.bytes, `with no start it took ${unsure.bytes} bytes, more than the ${eight.bytes} a known start took`);
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("26.8 a worklist call names each phase through the call's progress before it answers, and stops at its next phase once progress rejects, reading nothing more", { timeout: 120_000 }, async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
  try {
    await withCountedLibrary(async ({ library, project, received }) => {
      const [last] = await library.history({ newest: 1 });
      const started = new Date((last === undefined ? Date.now() : Date.parse(last.at)) + 1);
      await libraryClockPast(started);
      await library.writeKnowledge("principle", { title: "Edit first", description: "Edit before writing new.", statement: "Edit first.", why: "No near-copies.", howToApply: "Search first." });
      const tools = librarianTools();
      const acts = new Map<string, (args: unknown, call: ToolCall) => Promise<ToolAnswer>>();
      tools.registerTools!((name, _description, _input, act) => {
        acts.set(name, act as unknown as (args: unknown, call: ToolCall) => Promise<ToolAnswer>);
      });
      const callWith = (progress: (message: string) => Promise<void>): ToolCall => ({
        library, project, folder, writer: {}, progress,
        caller: { session: "s-1", harness: "claude-code" },
        log: { lines: async () => [{ kind: "session-started", session: "s-1", harness: "claude-code", at: started.toISOString() }] },
      });

      const phases: string[] = [];
      const answer = await acts.get("worklist")!({ memoryFolders: [folder], tools: ["worklist"] }, callWith(async (message) => {
        phases.push(message);
      }));
      assert.ok(answer.data?.worklist);
      assert.deepEqual(phases, ["graduation", "trigger", "links", "related", "health", "catalogue", "processes", "questions"]);

      let atFirst = 0;
      const cancelled = acts.get("worklist")!({ memoryFolders: [folder], tools: ["worklist"] }, callWith(async (message) => {
        if (message === "graduation") {
          atFirst = received();
          return;
        }
        throw new Error("cancelled");
      }));
      await assert.rejects(cancelled, /cancelled/);
      await quietFor(() => received() !== atFirst, 50, "a phase after the first reading the library");
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("26.9 the worklist tool answers in a size a session can read, including when creation timestamps tie: each list's first few notes named, with how many it holds", async (t) => {
  await withLibrary(async (library) => {
    const folder = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
    try {
      const long = "A decision's reasoning, at length. ".repeat(600);
      t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
      const decisions = [];
      for (let n = 0; n < 12; n += 1) decisions.push(await library.recordDecision({ title: `Decision ${n}`, text: long, status: "accepted" }));
      t.mock.timers.reset();
      assert.equal(new Set(decisions.map(({ createdAt }) => createdAt)).size, 1, "every note was created in the same millisecond");
      const tools = librarianTools();
      const acts = new Map<string, (args: unknown, call: ToolCall) => Promise<ToolAnswer>>();
      tools.registerTools!((name, _description, _input, act) => {
        acts.set(name, act as unknown as (args: unknown, call: ToolCall) => Promise<ToolAnswer>);
      });
      const answer = await acts.get("worklist")!({ memoryFolders: [folder] }, {
        library, project: "p", folder, writer: {},
        caller: { session: "s-1", harness: "claude-code" },
        log: { lines: async () => [] },
      });
      const listed = answer.data?.worklist as WorklistView;
      decisions.sort((a, b) => a.id < b.id ? -1 : 1);
      assert.deepEqual(listed.rest?.links, decisions.slice(0, 5).map(({ id, fields }) => ({ id, type: "decision", title: fields.title })));
      assert.equal(listed.rest?.counts.links, 12);
      const size = JSON.stringify(answer).length;
      const whole = JSON.stringify(await worklist(library, { memoryFolders: [folder] })).length;
      assert.ok(size < 8_000 && whole > 200_000, `the tool answered in ${size} characters, against ${whole} for the whole worklist`);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

test("26.10 a plugin's curation guidance is offered only when its own kinds were written, beneath the core lists and framed as plugin-supplied, and a plugin kind's write makes nothing else due", async () => {
  await withCountedLibrary(async ({ library, project }) => {
    const steps = { statement: "Tidy the notes.", trigger: "A note is written.", steps: "Merge duplicates.", surfaces: "The library.", failureModes: "A note lost." };
    const voice = await library.writeKnowledge("process", { title: "voice: merge duplicate notes", description: "Voice's curation.", ...steps });
    await library.writeKnowledge("process", { title: "diary: fold old entries", description: "Diary's curation.", ...steps });
    await library.writeKnowledge("process", { title: "voiceover: none of voice's", description: "Another plugin's name.", ...steps });
    const { cursor } = await library.changesSince(0);
    const pluginKinds = ["voice.note", "diary.entry"];

    assert.deepEqual(await roundDue(library, { since: cursor, pluginKinds }), { graduation: true, rest: false, plugins: [] });
    await withTestClient(async (client) => {
      const fields = { text: "Ring the plumber." };
      await client.query("INSERT INTO record_event (record_id, type, action, record, actor, at) VALUES ('voice.note_1', 'voice.note', 'created', $1::jsonb, 'the door', now())",
        [JSON.stringify({ id: "voice.note_1", type: "voice.note", version: 1, fields, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z" })]);
      await client.query("INSERT INTO record (id, type, version, fields, created_at, updated_at) VALUES ('voice.note_1', 'voice.note', 1, $1::jsonb, now(), now())", [JSON.stringify(fields)]);
    }, `storytree_${project}`);

    assert.deepEqual(await roundDue(library, { since: cursor, pluginKinds }), { graduation: true, rest: false, plugins: ["voice"] }, "only voice's guidance is due, and no core list");
    const quiet = await worklist(library, { since: cursor, pluginKinds });
    assert.equal(quiet.rest, undefined);
    assert.deepEqual(quiet.plugins?.map(({ plugin, kinds, guidance }) => ({ plugin, kinds, guidance: guidance.map((note) => note.id) })), [{ plugin: "voice", kinds: ["voice.note"], guidance: [voice.id] }]);
    assert.match(quiet.plugins![0]!.framing, /supplied by the voice plugin/i);
    assert.match(quiet.plugins![0]!.framing, /only to records of voice\.note/);
    assert.match(quiet.plugins![0]!.framing, /core rule holds/);

    const fired = await worklist(library, { pluginKinds });
    assert.deepEqual(Object.keys(fired), ["graduation", "rest", "plugins"], "the plugins' guidance comes after every core list");
    assert.deepEqual(fired.plugins?.map(({ plugin }) => plugin), ["voice", "diary"], "with no start each plugin's guidance is offered");
    assert.deepEqual(worklistView(fired).plugins?.map(({ plugin, guidance }) => ({ plugin, guidance: guidance.map((note) => note.title) })),
      [{ plugin: "voice", guidance: ["voice: merge duplicate notes"] }, { plugin: "diary", guidance: ["diary: fold old entries"] }]);

    assert.deepEqual(await worklist(library, { since: cursor }), { graduation: [] }, "with no plugin kinds named, no plugin's guidance is offered");
  });
});

test("26.5 the librarian's subagent definition names every tool the librarian serves", () => {
  const served: string[] = [];
  librarianTools().registerTools!((name) => { served.push(name); });
  const definition = readFileSync(new URL("../../../../../../.claude/agents/librarian-curator.md", import.meta.url), "utf8");
  assert.ok(served.length > 0);
  const tools = definition.split("\n").find((line) => line.startsWith("**Tools.**")) ?? "";
  const named = new Set(tools.match(/[\w-]+/g));
  assert.deepEqual(served.filter((name) => !named.has(name)), [], "tools the definition does not name");
});

async function libraryClockPast(at: Date): Promise<void> {
  await waitUntil(
    () => withTestClient(async (client) => (await client.query<{ past: boolean }>("SELECT now() > $1 AS past", [at])).rows[0]?.past),
    5_000,
    `the library's clock to pass ${at.toISOString()}`,
  );
}

test("26.12 · the link tool takes why, the supersede tool justifications and the annotate tool why, each stored as the justification of the decision edge it writes; the link tool joining two decisions with no why is refused naming justification and the target, and a definition rests on a decision with none", async () => {
  await withLibrary(async (library) => {
    const decide = (title: string) => library.recordDecision({ status: "accepted", title, text: `${title}.` });
    const queue = await decide("Mail by queue");
    const log = await decide("Mail is logged");
    const hand = await decide("Mail by hand");
    const retries = await decide("Retries are twice");
    const term = await library.defineTerm({ term: "Retry", meaning: "Sending again." });
    const call: ToolCall = { library, project: library.name, folder: ".", caller: { session: "curator" }, writer: { actor: "curator" }, log: { lines: async () => [] } };
    const acts = new Map<string, (args: unknown) => Promise<ToolAnswer>>();
    librarianTools().registerTools!((name, _description, input, act) => void acts.set(name, (args) => act(input.parse(args), call)));
    const justified = async (id: string): Promise<Record<string, string> | undefined> => ((await library.get(id))?.fields as { justifications?: Record<string, string> } | undefined)?.justifications;

    const { cursor } = await library.changesSince(0);
    await assert.rejects(acts.get("link")!({ from: retries.id, to: queue.id }), (error: Error) => error.message.includes("justification") && error.message.includes(queue.id));
    assert.deepEqual((await library.changesSince(cursor)).changes, [], "nothing was written");
    await acts.get("link")!({ from: retries.id, to: queue.id, why: "Follow it for where a retry waits." });
    await acts.get("link")!({ from: term.id, to: queue.id });
    assert.deepEqual(((await library.get(term.id))?.fields as { links?: string[] }).links, [queue.id], "a definition's link to its decision needs no why");

    const answer = await acts.get("supersede")!({ olds: [hand.id], successor: { title: "Mail by machine", text: "By machine." }, justifications: { [hand.id]: "Machines replace sending by hand." } });
    assert.deepEqual(await justified(answer.data!.id as string), { [hand.id]: "Machines replace sending by hand." });

    await acts.get("annotate")!({ target: log.id, by: retries.id, note: "Retries are logged once.", date: "2026-11-20", clauses: ["D1"], why: "Retries narrow what is logged." });
    assert.deepEqual(await justified(retries.id), { [queue.id]: "Follow it for where a retry waits.", [log.id]: "Retries narrow what is logged." });
  });
});
