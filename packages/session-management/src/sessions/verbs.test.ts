// Capability 4 · Sessions
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

    await assert.rejects(name.act({ title: "x".repeat(41) }, context, DOORS.tool), (error: unknown) => error instanceof VerbRefusal && /40/.test(error.message));
    const named = await name.act({ title: "Building signup" }, context, DOORS.command);
    assert.equal(named.text, 'Named this session "Building signup" in the sessions list.');
  } finally {
    await log.close();
    await removeTempDir(home);
  }
});

test("4.44 · point_at takes a gate beside its capability, on either door: it points at the gate between the two; a gate with no capability is the caller's misuse, and a gate that is no capability or is the capability again is refused naming it", async () => {
  const point = find("point_at");
  const log = await openActivityLog(testServerUrl());
  try {
    const project = uniqueProjectName();
    const library = { get: async (id: string) => ({ id, type: id.startsWith("cap-") ? "capability" : "story" }) } as unknown as Library;
    const context = { log, library, project, session: "claude-1", harness: "claude-code", folder: tmpdir() };
    const pointed = await point.act({ capability: "cap-send", gate: "cap-bounce", why: "The interface" }, context, DOORS.tool);
    assert.ok(pointed.text.includes("cap-send") && pointed.text.includes("cap-bounce"), "it answers naming both sides of the gate");
    const refused = (input: Parameters<typeof point.act>[0]) => point.act(input, context, DOORS.command).then(() => undefined, (error: unknown) => error instanceof VerbRefusal ? error : undefined);
    assert.equal((await refused({ gate: "cap-bounce", why: "Look" }))?.misuse, true, "a gate with no capability is misuse");
    for (const gate of ["cap-send", "story-mail"]) {
      const refusal = await refused({ capability: "cap-send", gate, why: "Look" });
      assert.ok(refusal !== undefined && !refusal.misuse && refusal.message.includes(gate), `${gate} is refused, named`);
    }
  } finally {
    await log.close();
  }
});

test("4.53 · storytree session show gives one session as the sessions list shows it, this session unless another is named, hidden ones included; a session the log has no line of is refused by its id", async () => {
  const show = SESSION_VERBS.find((one) => "name" in one.command && one.command.name === "show");
  assert.ok(show, "the session family has a show");
  const log = await openActivityLog(testServerUrl());
  try {
    const project = uniqueProjectName();
    const context = { log, library: {} as Library, project, session: "claude-1", harness: "claude-code", folder: tmpdir() };
    await log.append(project, { session: "claude-1", harness: "claude-code", source: "hook", kind: "session-named", title: "Building signup" });
    await log.append(project, { session: "lane-2", harness: "codex", source: "hook", kind: "prompt-submitted" });
    await log.append(project, { session: "lane-2", harness: "codex", source: "hook", kind: "closed-out", safe: true, why: "PR 9 merged", running: 0 });

    const own = await show.act({ json: false }, context, DOORS.command);
    assert.match(own.text, /^Claude Code claude-1: /);
    assert.match(own.text, /named: Building signup/);
    assert.doesNotMatch(own.text, /lane-2/);

    const other = await show.act({ session: "lane-2", json: false }, context, DOORS.command);
    assert.match(other.text, /^Codex lane-2: /);
    assert.match(other.text, /closed out .*: safe \(PR 9 merged\)/);
    const json = JSON.parse((await show.act({ session: "lane-2", json: true }, context, DOORS.command)).text) as { session: string };
    assert.equal(json.session, "lane-2");

    await assert.rejects(show.act({ session: "nobody-3", json: false }, context, DOORS.command), (error: unknown) => error instanceof VerbRefusal && error.message.includes("nobody-3"));
  } finally {
    await log.close();
  }
});
