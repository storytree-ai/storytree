/**
 * Capability 5 · Queues: contract 5.7, the `friction` and `resteer` verbs the librarian declares for the command line,
 * run with a context of a fresh project's library on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { DoorWords, VerbContext } from "@storytree/project-and-caller/verbs";

import { withLibrary } from "../testing/pg.js";
import { LIBRARIAN_FAMILIES } from "../verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("5.7 · the librarian declares the `friction` and `resteer` families the command line lists 13th and 14th: friction filed on one branch, with its links and the writer, is drained on another", async () => {
  await withLibrary(async (library) => {
    const [friction, resteer] = ["friction", "resteer"].map((name) => LIBRARIAN_FAMILIES.find((family) => family.name === name)!);
    assert.deepEqual([friction!.order, resteer!.order], [13, 14]);
    const verbOf = (name: string) => friction!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
    const folder = mkdtempSync(path.join(tmpdir(), "librarian-friction-"));
    try {
      execFileSync("git", ["-C", folder, "init", "-q", "-b", "fix/mail"]);
      const context: VerbContext = { library, project: "p", session: "s", folder, writer: { actor: "session:s" } };
      const decision = await library.recordDecision({ title: "Mail by queue", text: "Send mail from a queue.", status: "proposed" });
      const filed = await verbOf("new").act({
        title: "Slow mail",
        description: "Mail is delayed",
        statement: "Sending times out",
        evidence: "src/mail.ts: TimeoutError after 30 seconds",
        impact: "Readers cannot join",
        links: decision.id,
      }, context, WORDS);
      const [note] = await library.list("friction");
      assert.equal(filed.text, `Recorded friction ${note!.id}.`);
      assert.equal(note!.fields.provenance?.branch, "fix/mail");
      assert.deepEqual(note!.fields.links, [decision.id]);
      assert.equal((await library.history({ id: note!.id })).at(-1)?.actor, "session:s");

      assert.match((await verbOf("drain").act({}, context, WORDS)).text, /^No friction is due/, "its own branch's report is not drained");
      execFileSync("git", ["-C", folder, "checkout", "-q", "-b", "main"]);
      assert.match((await verbOf("drain").act({}, context, WORDS)).text, new RegExp(`^1 friction report due for routing:\\n  ${note!.id}  \\(0 recurrences\\)  Slow mail$`));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
