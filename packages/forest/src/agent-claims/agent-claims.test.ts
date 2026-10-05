/**
 * Capability 5 · Agent capability claims (the forest story): each running session with a row in the
 * sessions list outlines the territory of each capability it claims, in its colour (ADR-0923). The
 * agent log's lines are written out here as the app hands them to the page, with a stand-in clock,
 * so no database is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Line, NewLine } from "@storytree/agent-link/readings";
import { workStates } from "@storytree/arc-surface";
import type { AnnotatedStory, AnnotatedTree, ArcView } from "@storytree/library";

import { grove } from "../capability-tree/capability-tree.js";
import { sessionRows } from "../sessions-list/sessions-list.js";
import { claimTints, replayWisps, sessionColour, sessionWisps, type SessionWisp } from "./agent-claims.js";

const START = Date.UTC(2026, 8, 27, 12);
const MINUTE = 60_000;
const health = { reported: { state: "not-checked" }, verified: { state: "not-checked" } } as const;
const tree: AnnotatedTree = { arcs: [], stories: [
  { id: "signup", title: "Sign-up", health, capabilities: ["email_form", "password"].map(id => ({ id, title: id, dependsOn: [], proposed: true, status: "proposed" as const, contracts: [], health })) },
  { id: "billing", title: "Billing", health, capabilities: [{ id: "invoice", title: "invoice", dependsOn: [], proposed: true, status: "proposed" as const, contracts: [], health }] },
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
/** What the world outlines at `minutes`: each claimed capability, its colour and whether it is faded. */
const outlined = (log: Log, minutes: number) => [...claimTints(wisps(log, minutes))].map(([capability, { colour, faded }]) => [capability, colour, faded]);

test("5.1 a claim outlines that capability's territory in its session's colour, on any island; an increment claim outlines nothing (ADR-0923)", () => {
  const log = hook(0, new Log()).add(1, claim("email_form")).add(1, claim("password"));
  assert.deepEqual(outlined(log, 2), [["email_form", sessionColour("A"), false], ["password", sessionColour("A"), false]]);
  log.add(2, claim("invoice"));
  assert.deepEqual(outlined(log, 3).map(([capability]) => capability), ["email_form", "password", "invoice"], "a second island's claim is outlined too");
  assert.deepEqual(Object.keys(claimTints(wisps(log, 3)).get("invoice")!).filter(key => /label|reason|agent|name/i.test(key)), [], "no agent name or reason text");
  const arcs = [{ arc: { id: "arc", fields: { title: "Billing" } }, state: "active", questions: [],
    increments: [{ id: "inc", fields: { title: "Invoices", status: "active", touches: ["invoice"] } }] }] as unknown as ArcView[];
  const driving = new Log().add(0, { kind: "session-started", session: "E", harness: "codex", source: "hook" })
    .add(1, { kind: "claimed", session: "E", harness: "codex", source: "tool", increment: "inc", reason: "invoices" });
  assert.deepEqual([...claimTints(sessionWisps(sessionRows(tree, driving.lines, arcs, at(2)), driving.lines, at(2)))], [], "touching is not claiming");
});

test("5.2 after the quiet time with no new line the outline fades, and when its capability lands it goes", () => {
  const log = hook(0, new Log()).add(1, claim("email_form"));
  assert.deepEqual(outlined(log, 30), [["email_form", sessionColour("A"), false]]);
  assert.deepEqual(outlined(log, 32), [["email_form", sessionColour("A"), true]]);
  log.add(40, { kind: "landed", ...a, source: "tool", capability: "email_form" });
  assert.deepEqual(outlined(log, 41), []);
});

test("5.3 a hookless holder's outline stays unfaded even past the quiet time", () => {
  const log = new Log().add(1, { kind: "claimed", session: "B", harness: "codex", source: "tool", capability: "email_form", reason: "fixing the form" });
  for (const minutes of [2, 60]) {
    assert.deepEqual(outlined(log, minutes), [["email_form", sessionColour("B"), false]],
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

test("5.5 a session keeps one colour, never green or the needs-you amber; a folded subagent outlines in its parent's colour", () => {
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
  assert.deepEqual(outlined(log, 4), [["email_form", sessionColour("A"), false], ["invoice", sessionColour("A"), false]],
    "a folded child's claim is outlined in its parent's colour; D has no row and claims nothing");
});

test("5.7 replaying a growth, the sessions recorded with the latest stage reached outline the territories they held, none before the first", () => {
  const wisp = (session: string, story: string): SessionWisp => ({ session, story, colour: sessionColour(session), phase: 0, faded: false, capabilities: [] });
  // Recorded: nobody, then A on the shop, then A and B, then A landed and B still on the till, then nobody.
  const stages = [
    { at: 1, wisps: [] },
    { at: 2, wisps: [wisp("A", "shop")] },
    { at: 4, wisps: [wisp("A", "shop"), wisp("B", "till")] },
    { at: 4, wisps: [wisp("B", "till")] },
    { at: 7, wisps: [] },
  ];
  const at = (now: number) => replayWisps(stages, now).map(w => `${w.session}@${w.story}`);
  assert.deepEqual(at(0), [], "nothing before the recording's first stage");
  assert.deepEqual(at(1.5), []);
  assert.deepEqual(at(2), ["A@shop"]);
  assert.deepEqual(at(3.9), ["A@shop"]);
  assert.deepEqual(at(4), ["B@till"], "two stages at one moment: the later recorded wins");
  assert.deepEqual(at(6), ["B@till"]);
  assert.deepEqual(at(Infinity), [], "the end shows what the recording ends with");
  assert.deepEqual(replayWisps([], 3), []);
});
