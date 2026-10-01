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

import { withLibrary } from "../testing/pg.js";
import { roundDue, worklist } from "./index.js";
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
