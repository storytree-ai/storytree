/**
 * Capability 6 · Rounds: contracts 6.1-6.2, 6.6 and 6.7 in the librarian story, each in a fresh project's
 * library on the real Postgres `pnpm test` provides; 6.5 against the librarian's subagent definition.
 * 6.3-6.4 are proven beside the agent link's server (packages/agent-link/src/tools/librarian-tools.test.ts).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { healthHistory, withCountedLibrary, withLibrary } from "../testing/pg.js";
import { roundDue, worklist } from "../index.js";
import type { ToolAnswer, ToolCall } from "./host.js";
import { librarianTools } from "./tools.js";

test("6.1 the trigger fires on a write to a curated kind since the session started, and when there is no start; graduation is due either way", async () => {
  await withLibrary(async (library) => {
    const { cursor: start } = await library.changesSince(0);
    await library.writeKnowledge("techstack", { title: "Postgres", description: "Project storage", statement: "Each project uses Postgres.", whatItIs: "A relational database.", whyThis: "Transactional writes and history." });
    assert.deepEqual(await roundDue(library, { since: start }), { graduation: true, rest: false });

    await library.writeKnowledge("principle", { title: "Edit first", description: "Edit before writing new.", statement: "Edit first.", why: "No near-copies.", howToApply: "Search first." });
    assert.deepEqual(await roundDue(library, { since: start }), { graduation: true, rest: true });
    assert.deepEqual(await roundDue(library, {}), { graduation: true, rest: true });
  });
});

test("6.2 the worklist gathers each capability's list: graduation's and the friction drain always, the rest only when the trigger fired", async () => {
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
      const theirs = await library.writeKnowledge("friction", { ...report, provenance: { branch: "claude/other", date: "2026-09-29", source: "retro" } });
      await library.writeKnowledge("friction", { ...report, provenance: { branch: "claude/me", date: "2026-09-29", source: "retro" } });
      await library.writeKnowledge("techstack", { title: "Postgres", description: "Project storage", statement: "Each project uses Postgres.", whatItIs: "A relational database.", whyThis: "Transactional writes and history." });

      const quiet = await worklist(library, { since: cursor, memoryFolders: [folder], branch: "claude/me" });
      assert.deepEqual(quiet.graduation.map((item) => item.file), [memory]);
      assert.deepEqual(quiet.friction.map((note) => note.id), [theirs.id]);
      assert.equal(quiet.rest, undefined);

      const fired = await worklist(library, { since: 0, memoryFolders: [folder], branch: "claude/me" });
      assert.deepEqual(fired.graduation.map((item) => item.file), [memory]);
      assert.deepEqual(fired.rest?.links.map((decision) => decision.id), [spec.id]);
      assert.deepEqual(fired.rest?.health, []);
      assert.ok(fired.rest?.catalogue?.some(({ note }) => note.id === spec.id));
      assert.deepEqual(fired.rest?.questions, []);
      assert.deepEqual(fired.friction.map((note) => note.id), [theirs.id]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("6.6 the worklist and land's next-line check take about as much from a library whose history holds weeks of changes, and health piling up since the session started, as from one whose history holds an hour's", { timeout: 120_000 }, async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
  const taken: number[] = [];
  let history = 0;
  try {
    for (const long of [false, true]) {
      await withCountedLibrary(async ({ library, project, received }) => {
        const started = new Date(Date.now() - 2 * 3_600_000);
        if (long) {
          // Weeks of CI runs before the session started, and an hour and more of them since.
          await healthHistory(project, 40_000, new Date(started.getTime() - 3 * 86_400_000));
          history = await healthHistory(project, 4_000, new Date(started.getTime() + 1_000));
        }
        // A curated write since the session started: the rest of the pass is due, and read too.
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
        const listed = answer.data?.worklist as Awaited<ReturnType<typeof worklist>>;
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

test("6.7 the worklist reads the live notes about once however many notes the session wrote, and with no recorded start leaves the catalogue and related lists unread, saying why, rather than reading every note's history", { timeout: 300_000 }, async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
  const principle = (n: number, title: string) => ({ title, description: `Lesson ${n}`, statement: `Lesson ${n} holds.`, why: `Learned the hard way, ${n}. `.repeat(40), howToApply: "Apply it." });
  try {
    await withCountedLibrary(async ({ library, project, received }) => {
      // A library of some size, its notes each edited, before the session started.
      for (let n = 0; n < 120; n += 1) {
        const note = await library.writeKnowledge("principle", principle(n, `Older lesson number ${n}`));
        await library.editNote(note.id, { statement: `Lesson ${n} holds, edited.` });
      }
      // The start just after the last older edit by the library's own clock, which a runner's may not match.
      const [last] = await library.history({ newest: 1 });
      const started = new Date(Date.parse(last!.at) + 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
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
      const take = async (start: boolean): Promise<{ bytes: number; listed: Awaited<ReturnType<typeof worklist>> & { rest?: { unread?: string } } }> => {
        before = received();
        const answer = await acts.get("worklist")!({ memoryFolders: [folder] }, callFor(start));
        return { bytes: received() - before, listed: answer.data?.worklist as Awaited<ReturnType<typeof worklist>> };
      };

      await library.writeKnowledge("principle", principle(1000, "Graduate durable memory every landing"));
      const one = await take(true);
      for (let n = 1001; n < 1008; n += 1) await library.writeKnowledge("principle", principle(n, `Session lesson about worklists, phases and stalls ${n}`));
      const eight = await take(true);
      assert.equal(eight.listed.rest?.catalogue?.length, 8);
      assert.equal(eight.listed.rest?.related?.length, 8);
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

test("6.5 the librarian's subagent definition names every tool the librarian serves", () => {
  const served: string[] = [];
  librarianTools().registerTools!((name) => { served.push(name); });
  const definition = readFileSync(new URL("../../../../.claude/agents/librarian-curator.md", import.meta.url), "utf8");
  assert.ok(served.length > 0);
  // The role's tools field, which the generated definition writes as its "**Tools.**" paragraph.
  const tools = definition.split("\n").find((line) => line.startsWith("**Tools.**")) ?? "";
  const named = new Set(tools.match(/[\w-]+/g));
  assert.deepEqual(served.filter((name) => !named.has(name)), [], "tools the definition does not name");
});
