/**
 * Capability 6 · Rounds: contracts 6.1-6.2 in the librarian story, each in a fresh project's
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
      assert.ok(fired.rest?.catalogue.some(({ note }) => note.id === spec.id));
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
        assert.deepEqual(listed.rest?.catalogue.map(({ note }) => note.id), [principle.id], "the note written since the session started, and nothing older");
        taken.push(received() - before);
      });
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  assert.ok(history > 20_000_000, `the long history is weeks' worth: ${history} bytes`);
  assert.ok(taken[1]! - taken[0]! < 128 * 1024, `the calls took ${taken[0]} bytes from a short history and ${taken[1]} from one ${history} bytes longer: no more than 128 KiB apart`);
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
