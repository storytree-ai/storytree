/**
 * Capability 6 · Unclaimed work (the forest story): the edits and commands of sessions holding no
 * claim, listed beside the forest with a count, and never guessed onto a story. The agent log's
 * lines and the library's tree are written out here as the app hands them to the page, so no
 * database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link/readings";
import { workStates } from "@storytree/arc-surface";
import type { AnnotatedTree, Change } from "@storytree/library";

import { forestScene } from "../render/forest-scene.js";
import { unclaimedWork } from "./unclaimed-work.js";

class Log {
  readonly lines: Line[] = [];

  add(line: NewLine): this {
    const seq = this.lines.length + 1;
    this.lines.push({ ...line, seq, project: "shop", at: new Date(Date.UTC(2026, 8, 27, 12, seq)).toISOString() });
    return this;
  }
}

const b = { session: "B", harness: "claude-code" } as const;
const edit = (file: string): NewLine => ({ kind: "file-edited", ...b, source: "hook", files: [file] });

const tree: AnnotatedTree = {
  stories: [{ id: "s", title: "Sign-up", capabilities: [{ id: "email_form", title: "Email form", dependsOn: [], contracts: [], health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } } }], health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } } }],
  arcs: [],
};
const history: Change[] = [];

test("6.1 two edits by a session holding nothing are listed with its name, the files and the time, the count reads 2, and no story node changes", () => {
  const log = new Log();
  const before = forestScene(tree, history, workStates(log.lines));
  log.add(edit("src/a.ts")).add(edit("src/b.ts"));
  const work = unclaimedWork(log.lines);
  assert.equal(work.count, 2);
  assert.deepEqual(work.entries.map(({ agent, files, at }) => [agent, files, at]), [
    ["Claude Code", ["src/b.ts"], log.lines[1]?.at],
    ["Claude Code", ["src/a.ts"], log.lines[0]?.at],
  ], "newest first");
  assert.deepEqual(forestScene(tree, history, workStates(log.lines)).islands.map(({ key }) => key), before.islands.map(({ key }) => key));
});

test("6.2 after a claim, the session's next edit counts toward that capability instead", () => {
  const log = new Log().add(edit("src/a.ts")).add(edit("src/b.ts"));
  log.add({ kind: "claimed", ...b, source: "tool", capability: "email_form", reason: "building the email form" }).add(edit("src/form.ts"));
  assert.equal(unclaimedWork(log.lines).count, 2);
  assert.ok(!unclaimedWork(log.lines).entries.some(({ files }) => files.includes("src/form.ts")));
});

test("6.3 an agent that never calls storytree still appears, through its hooks", () => {
  const log = new Log()
    .add({ kind: "session-started", session: "C", harness: "codex", source: "hook" })
    .add({ kind: "command-run", session: "C", harness: "codex", source: "hook", command: "npm install" });
  assert.deepEqual(unclaimedWork(log.lines).entries.map(({ agent, command }) => [agent, command]), [["Codex", "npm install"]]);
});
