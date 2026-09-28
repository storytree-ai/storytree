/**
 * Capability 5 · Agent capability claims (the forest story): each running session with a row in the
 * sessions list is a wisp orbiting the island of each story it holds a claim in (ADR-0736). The
 * agent log's lines are written out here as the app hands them to the page, with a stand-in clock,
 * so no database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link/readings";
import { workStates } from "@storytree/arc-surface";
import type { AnnotatedStory, AnnotatedTree } from "@storytree/library";

import { grove } from "../capability-tree/capability-tree.js";
import { sessionRows } from "../sessions-list/sessions-list.js";
import { sessionColour, sessionWisps } from "./agent-claims.js";

const START = Date.UTC(2026, 8, 27, 12);
const MINUTE = 60_000;
const health = { reported: { state: "not-checked" }, verified: { state: "not-checked" } } as const;
const tree: AnnotatedTree = { arcs: [], stories: [
  { id: "signup", title: "Sign-up", health, capabilities: ["email_form", "password"].map(id => ({ id, title: id, dependsOn: [], contracts: [], health })) },
  { id: "billing", title: "Billing", health, capabilities: [{ id: "invoice", title: "invoice", dependsOn: [], contracts: [], health }] },
] };

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
const claim = (capability: string): NewLine => ({ kind: "claimed", ...a, source: "tool", capability, reason: "building sign-up" });
const wisps = (log: Log, minutes: number) => sessionWisps(sessionRows(tree, log.lines, [], at(minutes)), log.lines, at(minutes));
const brief = (log: Log, minutes: number) => wisps(log, minutes).map(({ session, story, faded }) => ({ session, story, faded }));

test("5.1 a claim sends one wisp of its session round that capability's island, a second island gets a second", () => {
  const log = hook(0, new Log()).add(1, claim("email_form")).add(1, claim("password"));
  assert.deepEqual(brief(log, 2), [{ session: "A", story: "signup", faded: false }], "two claims on one island are one wisp");
  log.add(2, claim("invoice"));
  const drawn = wisps(log, 3);
  assert.deepEqual(drawn.map(({ story }) => story), ["signup", "billing"]);
  assert.ok(drawn.every(({ colour }) => colour === sessionColour("A")), "every wisp of a session wears its colour");
  assert.deepEqual(Object.keys(drawn[0]!).filter(key => /label|reason|agent|name/i.test(key)), [], "no agent name or reason text");
});

test("5.2 after the quiet time with no new line the wisp fades, and when its last capability on the island lands it goes", () => {
  const log = hook(0, new Log()).add(1, claim("email_form"));
  assert.equal(brief(log, 30)[0]?.faded, false);
  assert.equal(brief(log, 32)[0]?.faded, true);
  log.add(40, { kind: "landed", ...a, source: "tool", capability: "email_form" });
  assert.deepEqual(brief(log, 41), []);
});

test("5.3 a hookless holder's wisp stays unfaded even past the quiet time", () => {
  const log = new Log().add(1, { kind: "claimed", session: "B", harness: "codex", source: "tool", capability: "email_form", reason: "fixing the form" });
  for (const minutes of [2, 60]) {
    assert.deepEqual(brief(log, minutes), [{ session: "B", story: "signup", faded: false }],
      "missing hooks are diagnosed by setup, never drawn as idle or a warning on the map");
  }
});

test("5.4 none of this changes how a capability's state is drawn", () => {
  const story: AnnotatedStory = tree.stories[0]!;
  const log = hook(0, new Log()).add(1, claim("email_form"));
  const forms = () => grove(story, workStates(log.lines)).map(({ form, state }) => [form, state]);
  const live = forms();
  assert.equal(brief(log, 60)[0]?.faded, true, "the holder has gone idle");
  assert.deepEqual(forms(), live, "an idle holder draws the same tree as a live one");
  assert.deepEqual(Object.keys(wisps(log, 2)[0] ?? {}).filter((key) => /health|report|form|state/i.test(key)), [], "a wisp carries no health or state");
});

test("5.5 a session keeps one colour, never green or the needs-you amber; folded subagents and rowless sessions draw no wisp", () => {
  const sessions = Array.from({ length: 40 }, (_, index) => `session-${index}`);
  for (const session of sessions) {
    assert.equal(sessionColour(session), sessionColour(session));
    const hue = Number(/^hsl\((\d+)/.exec(sessionColour(session))?.[1]);
    assert.ok(!(hue >= 30 && hue < 170), `${session}'s hue ${hue} is outside amber and green`);
  }
  assert.ok(new Set(sessions.map(sessionColour)).size > 30, "sessions are told apart by colour");
  const log = hook(0, new Log()).add(1, claim("email_form"))
    .add(2, { kind: "subagent-started", ...a, source: "hook", subagent: "C", task: "billing" })
    .add(3, { kind: "claimed", session: "C", harness: "claude-code", source: "tool", capability: "invoice", reason: "billing" })
    .add(3, { kind: "file-edited", session: "D", harness: "codex", source: "hook", files: ["a.ts"] });
  assert.deepEqual(wisps(log, 4).map(({ session }) => session), ["A", "A"], "the parent orbits for its folded child; D has no row");
});
