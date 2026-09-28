/**
 * Capability 5 · Agent capability claims (the forest story): which agent holds which capability
 * right now, as a quiet dot at that capability's tree. The agent log's lines are
 * written out here as the app hands them to the page, with a stand-in clock, so no database is
 * needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link/readings";
import { workStates } from "@storytree/arc-surface";
import type { AnnotatedStory } from "@storytree/library";

import { grove } from "../capability-tree/capability-tree.js";
import { claimMarkers } from "./agent-claims.js";

const START = Date.UTC(2026, 8, 27, 12);
const MINUTE = 60_000;

/** A project's agent log, each line written `at` minutes after the start. */
class Log {
  readonly lines: Line[] = [];

  add(minutes: number, line: NewLine): this {
    this.lines.push({ ...line, seq: this.lines.length + 1, project: "shop", at: new Date(START + minutes * MINUTE).toISOString() });
    return this;
  }
}

const a = { session: "A", harness: "claude-code" } as const;
const hook = (minutes: number, log: Log) => log.add(minutes, { kind: "session-started", ...a, source: "hook" });
const at = (minutes: number) => new Date(START + minutes * MINUTE);

// Replace the former label assertion with the quiet marker reading; Chromium checks its drawing.
test("5.1 a claim supplies a quiet dot at its capability's tree", () => {
  const log = hook(0, new Log()).add(1, { kind: "claimed", ...a, source: "tool", capability: "email_form", reason: "building the email form" });
  assert.deepEqual(claimMarkers(log.lines, at(2)), [
    { capability: "email_form", session: "A", faded: false },
  ]);
});

test("5.2 after the quiet time with no new line the marker fades, and when the capability lands it goes", () => {
  const log = hook(0, new Log()).add(1, { kind: "claimed", ...a, source: "tool", capability: "email_form", reason: "building the email form" });
  assert.equal(claimMarkers(log.lines, at(30))[0]?.faded, false);
  assert.equal(claimMarkers(log.lines, at(32))[0]?.faded, true);
  log.add(40, { kind: "landed", ...a, source: "tool", capability: "email_form" });
  assert.deepEqual(claimMarkers(log.lines, at(41)), []);
});

test("5.3 a hookless holder's dot stays unfaded even past the quiet time", () => {
  const log = new Log().add(1, { kind: "claimed", session: "B", harness: "codex", source: "tool", capability: "email_form", reason: "fixing the form" });
  for (const minutes of [2, 60]) {
    assert.deepEqual(claimMarkers(log.lines, at(minutes)), [
      { capability: "email_form", session: "B", faded: false },
    ], "missing hooks are diagnosed by setup, never drawn as idle or a warning on the map");
  }
});

test("5.4 none of this changes how a capability's state is drawn", () => {
  const story: AnnotatedStory = {
    id: "s",
    title: "Sign-up",
    capabilities: [{ id: "email_form", title: "Email form", dependsOn: [], contracts: [], health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } } }],
    health: { reported: { state: "not-checked" }, verified: { state: "not-checked" } },
  };
  const log = hook(0, new Log()).add(1, { kind: "claimed", ...a, source: "tool", capability: "email_form", reason: "building the email form" });
  const forms = () => grove(story, workStates(log.lines)).map(({ form, state }) => [form, state]);
  const live = forms();
  assert.equal(claimMarkers(log.lines, at(60))[0]?.faded, true, "the holder has gone idle");
  assert.deepEqual(forms(), live, "an idle holder draws the same tree as a live one");
  assert.deepEqual(Object.keys(claimMarkers(log.lines, at(2))[0] ?? {}).filter((key) => /health|report|form|state/i.test(key)), [], "a marker carries no health or state");
});
