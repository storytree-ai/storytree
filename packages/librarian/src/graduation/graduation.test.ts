/**
 * Capability 4 · Graduation: one test per contract 4.1-4.4 in the librarian story. The memory
 * folders are throwaway ones, laid out as Claude Code keeps its own; the library is a fresh
 * project's on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { withLibrary } from "../testing/pg.js";
import { graduate, memoryWorklist, park, processGaps } from "./index.js";

const DAY = 24 * 60 * 60 * 1000;

/** Run `body` with a fresh memory folder, `<project>/memory`, removed afterwards. */
async function withMemoryFolder(body: (folder: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-librarian-"));
  const folder = path.join(root, "memory");
  mkdirSync(folder);
  try {
    await body(folder);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function memory(folder: string, name: string, lesson: string): string {
  const file = path.join(folder, `${name}.md`);
  writeFileSync(file, `---\nname: ${name}\ndescription: ${lesson}\nmetadata:\n  type: feedback\n---\n\n${lesson}\n`);
  return file;
}

test("4.1 the worklist lists each memory that is new, changed since it was parked, or parked more than 60 days ago", async () => {
  await withMemoryFolder(async (folder) => {
    const now = new Date("2026-09-27T12:00:00Z");
    const fresh = memory(folder, "fresh", "Run the seed with the app closed.");
    const kept = memory(folder, "kept", "The owner reads the debrief first.");
    const changed = memory(folder, "changed", "Prefer plain search.");
    const old = memory(folder, "old", "Measure before leaving anything out.");
    writeFileSync(path.join(folder, "MEMORY.md"), "- [Kept](kept.md) — the debrief\n");
    await park(kept, "Still true, and only this user's.", { now: new Date(now.getTime() - 10 * DAY) });
    await park(changed, "Still true.", { now: new Date(now.getTime() - 10 * DAY) });
    await park(old, "Still true.", { now: new Date(now.getTime() - 61 * DAY) });
    writeFileSync(changed, readFileSync(changed, "utf8").replace("plain search", "plain word search"));

    const listed = await memoryWorklist([folder], { now });
    assert.deepEqual(
      listed.map(({ file, why }) => ({ file, why })),
      [
        { file: changed, why: "changed" },
        { file: fresh, why: "new" },
        { file: old, why: "lapsed" },
      ],
    );
  });
});

test("4.2 park keeps the reason, the date and what the memory said beside the memory folder, never in the library", async () => {
  await withMemoryFolder(async (folder) => {
    const file = memory(folder, "kept", "The owner reads the debrief first.");
    await park(file, "Only this user's habit.", { now: new Date("2026-09-27T12:00:00Z") });

    const ledger = JSON.parse(readFileSync(path.join(path.dirname(folder), "graduation-park.json"), "utf8"));
    assert.equal(ledger["kept.md"].reason, "Only this user's habit.");
    assert.equal(ledger["kept.md"].parkedAt, "2026-09-27T12:00:00.000Z");
    assert.equal(typeof ledger["kept.md"].hash, "string");
    assert.deepEqual(await memoryWorklist([folder], { now: new Date("2026-09-28T12:00:00Z") }), []);
  });
});

test("4.3 graduate writes the lesson as a principle, process or definition and only then deletes the memory", async () => {
  await withLibrary(async (library) => {
    await withMemoryFolder(async (folder) => {
      const file = memory(folder, "measure", "Measure before leaving anything out.");
      writeFileSync(path.join(folder, "MEMORY.md"), "- [Measure](measure.md) — ADR-0639\n- [Other](other.md) — kept\n");
      const lesson = {
        title: "Measure before leaving anything out",
        description: "A leave-out rests on 0.2's record.",
        statement: "Before a piece of 0.2 is left out, its use in 0.2 is measured.",
        why: "What did not last is not worth porting; what lasted is the owner's to cut.",
        howToApply: "Count its use in the last six weeks before the freeze, and record the numbers.",
      };

      await assert.rejects(graduate(library, file, "principle", { ...lesson, why: "" }));
      await assert.rejects(graduate(library, file, "guardrail", lesson), /principle, process or definition/);
      assert.ok(existsSync(file));
      assert.deepEqual(await library.search("measured"), []);

      const note = await graduate(library, file, "principle", lesson);
      assert.equal(note.type, "principle");
      assert.equal((await library.search("measured"))[0]?.id, note.id);
      assert.ok(!existsSync(file));
      assert.equal(readFileSync(path.join(folder, "MEMORY.md"), "utf8"), "- [Other](other.md) — kept\n");
    });
  });
});

test("4.4 the worklist lists each process naming none of the tools served, and each tool no process names", async () => {
  await withLibrary(async (library) => {
    const process = (title: string, surfaces: string) =>
      library.writeKnowledge("process", {
        title,
        description: `${title}.`,
        statement: `${title}.`,
        trigger: "At a landing.",
        steps: "1. Do it.",
        surfaces,
        failureModes: "It is skipped.",
      });
    await process("Draw a rests-on link", "The `link` tool.");
    const orphan = await process("Hold a retro", "A meeting with the owner.");

    const gaps = await processGaps(library, ["link", "retire", "park"]);
    assert.deepEqual(gaps.processes.map((one) => one.id), [orphan.id]);
    assert.deepEqual(gaps.tools, ["retire", "park"]);
  });
});
