/**
 * Capability 4 · Sessions. The session verbs, declared once under the library's command schema (ADR-0969 D2,
 * ADR-1035): naming a session, closing it out and listing the sessions answer the same from either door; how each door
 * reads their words is the door's own (the command line's 13.1). Lines go to the real agent activity log on the Postgres
 * `pnpm test` provides; the process ledger is a throwaway home.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { openActivityLog } from "../activity/index.js";
import { removeTempDir } from "@storytree/project-and-caller/testing/folders";
import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "@storytree/library/verbs";

import { SESSION_VERBS, type SessionVerbContext } from "./verbs.js";

const DOORS: Record<"command" | "tool", DoorWords> = {
  command: { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` },
  tool: { door: "tool", say: (step) => step.tool ?? `storytree ${step.command!}` },
};

function given(words: readonly string[], flags: Readonly<Record<string, string>>) {
  return { word: (index: number) => words[index], flag: (name: string) => flags[name], flags: (name: string) => name in flags ? [flags[name]!] : [], has: (name: string) => name in flags, names: () => Object.keys(flags) };
}

function find(tool: string): Verb<VerbInputs, SessionVerbContext> {
  const found = SESSION_VERBS.find((one) => "name" in one.tool && one.tool.name === tool);
  assert.ok(found, tool);
  return found;
}

test("4.34 · naming a session, closing it out and listing the sessions are verbs declared once: closing out or naming answers in the same sentence for either door, writing to the calling session's log", async () => {
  const close = find("close_out");
  const name = find("name_session");
  const list = SESSION_VERBS.find((one) => "name" in one.command && one.command.name === "list")!;
  assert.ok("absent" in list.tool, "listing the sessions has no tool, and says why");
  const input = { safe: false, why: "handoff" };

  const log = await openActivityLog(testServerUrl());
  const home = await mkdtemp(path.join(tmpdir(), "verbs-"));
  try {
    const project = uniqueProjectName();
    const context = { log, library: {} as Library, project, session: "claude-1", harness: "claude-code", folder: home, home };
    await log.append(project, { session: "claude-1", harness: "claude-code", source: "tool", kind: "claimed", capability: "form", reason: "building it" });
    const byCommand = await close.act(input, context, DOORS.command);
    const byTool = await close.act(input, context, DOORS.tool);
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
