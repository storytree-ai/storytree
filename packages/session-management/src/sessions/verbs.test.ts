/**
 * Capability 4 · Sessions. The verb contract (ADR-0969 D2): a session verb is declared once, and what either door
 * reads from its caller reaches the same work and the same answer. Lines go to the real agent activity log on the
 * Postgres `pnpm test` provides; the process ledger is a throwaway home.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { openActivityLog } from "../activity/index.js";
import { removeTempDir } from "../testing/folders.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { commandInput, commandUsage, SESSION_VERBS, toolInput, VerbRefusal, type DoorWords, type Verb } from "./verbs.js";

const DOORS: Record<"command" | "tool", DoorWords> = {
  command: { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` },
  tool: { door: "tool", say: (step) => step.tool ?? `storytree ${step.command!}` },
};

function given(words: readonly string[], flags: Readonly<Record<string, string>>) {
  return { word: (index: number) => words[index], flag: (name: string) => flags[name], has: (name: string) => name in flags };
}

function find(tool: string): Verb {
  const found = SESSION_VERBS.find((one) => "name" in one.tool && one.tool.name === tool);
  assert.ok(found, tool);
  return found;
}

test("4.31 a verb declared once reads a command's words and flags and a tool's arguments to the same input, refuses the same wrong input on both, and does the same work and answers in the same sentence for either door", async () => {
  const close = find("close_out");
  assert.equal(commandUsage(close), "session close-out --safe yes|no --why <why>");
  const fromCommand = commandInput(close, given([], { safe: "no", why: " handoff " }));
  const fromTool = toolInput(close, { safe: false, why: "handoff" });
  assert.deepEqual(fromCommand, fromTool);
  assert.deepEqual(fromTool, { safe: false, why: "handoff" });
  // Wrong input is refused on both doors, as a misuse the command line shows its usage for.
  for (const refused of [() => commandInput(close, given([], { safe: "maybe", why: "x" })), () => commandInput(close, given([], { safe: "yes", why: "  " })), () => toolInput(close, { safe: true, why: "  " })]) {
    assert.throws(refused, (error: unknown) => error instanceof VerbRefusal && error.misuse);
  }

  const name = find("name_session");
  assert.equal(commandUsage(name), "session name <title>");
  assert.deepEqual(commandInput(name, given(["Building signup"], {})), toolInput(name, { title: "Building signup" }));
  const list = SESSION_VERBS.find((one) => "name" in one.command && one.command.name === "list")!;
  assert.ok("absent" in list.tool, "listing the sessions has no tool, and says why");
  assert.equal(commandUsage(list), "session list [--all] [--json]");
  assert.deepEqual(toolInput(list, {}), { all: false, json: false });

  const log = await openActivityLog(testServerUrl());
  const home = await mkdtemp(path.join(tmpdir(), "verbs-"));
  try {
    const project = uniqueProjectName();
    const context = { log, library: {} as Library, project, session: "claude-1", harness: "claude-code", folder: home, home };
    await log.append(project, { session: "claude-1", harness: "claude-code", source: "tool", kind: "claimed", capability: "form", reason: "building it" });
    const byCommand = await close.act(fromCommand, context, DOORS.command);
    const byTool = await close.act(fromTool, context, DOORS.tool);
    assert.equal(byCommand.text, "Closed out: not safe to close (handoff). Nothing of yours is running here. Released claims: form.");
    assert.equal(byTool.text, "Closed out: not safe to close (handoff). Nothing of yours is running here. No claims to release.");
    assert.deepEqual(byTool.data, { safe: false, released: [], running: 0 });

    // A refusal from the work is the verb's own, on either door.
    await assert.rejects(name.act({ title: "x".repeat(41) }, context, DOORS.tool), (error: unknown) => error instanceof VerbRefusal && /40/.test(error.message));
    const named = await name.act({ title: "Building signup" }, context, DOORS.command);
    assert.equal(named.text, 'Named this session "Building signup" in the sessions list.');
  } finally {
    await log.close();
    await removeTempDir(home);
  }
});
