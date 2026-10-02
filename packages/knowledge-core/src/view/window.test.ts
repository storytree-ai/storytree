/** Capability 4 · 4.16: the core reads a selected session's window from its host, and only that session's. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionWindow } from "@storytree/agent-link";

import { drawnRoster } from "../look-inside/look-inside.js";
import { createKnowledgeCore } from "./surface.js";

test("4.16 selecting a session asks the host for its window; one answered after the selection moved on is dropped, and going back to every session shows none", async () => {
  const asked: string[] = [];
  const answers = new Map<string, (window: SessionWindow) => void>();
  const core = createKnowledgeCore("app", { reads: { windowReading: (project, session) => {
    asked.push(`${project} ${session}`);
    return new Promise((resolve) => answers.set(session, resolve));
  }, windowReadings: async () => [] } });
  const windowOf = (): SessionWindow | undefined => (core as unknown as { get(): { window: SessionWindow | undefined } }).get().window;
  const reading = (session: string): SessionWindow => ({ session, at: "-", inView: [], opens: [], glimpses: [], compactions: 0 });
  try {
    core.select("S");
    core.select("T");
    answers.get("S")?.(reading("S"));
    answers.get("T")?.(reading("T"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(asked, ["app S", "app T"]);
    assert.equal(windowOf()?.session, "T");

    core.select(undefined);
    assert.equal(windowOf(), undefined);
  } finally {
    core.dispose();
  }
});

test("4.18 with none selected, showing the listed sessions asks the host once for all their windows, a child's too, starts no round while one is out, and keeps only the listed", async () => {
  const asked: string[][] = [];
  let answer: (() => void) | undefined;
  const reading = (session: string): SessionWindow => ({ session, at: "-", inView: [], opens: [], glimpses: [], compactions: 0 });
  const core = createKnowledgeCore("app", { reads: {
    windowReading: async (_project, session) => reading(session),
    windowReadings: (project, sessions) => {
      asked.push([project, ...sessions]);
      return new Promise((resolve) => { answer = () => resolve(sessions.map(reading)); });
    },
  } });
  const windowsOf = (): string[] => [...(core as unknown as { get(): { windows: ReadonlyMap<string, SessionWindow> } }).get().windows.keys()].sort();
  const a = { session: "a", label: "A", colour: "hsl(1, 80%, 68%)", members: ["a", "a-child"] };
  const b = { session: "b", label: "B", colour: "hsl(2, 80%, 68%)", members: ["b"] };
  const c = { session: "c", label: "C", colour: "hsl(3, 80%, 68%)", members: ["c"] };
  try {
    core.showRoster([a, b]);
    core.showRoster([a, b, c]);
    assert.deepEqual(asked, [["app", "a", "a-child", "b"]], "one ask for every listed window, and none more while it is out");
    answer?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(windowsOf(), ["a", "a-child", "b"]);

    core.showRoster([b, c]);
    assert.deepEqual(asked.at(-1), ["app", "c"], "a newly listed session is asked for, not those already read");
    assert.deepEqual(windowsOf(), ["b"], "a session that left the list is no longer drawn");
  } finally {
    core.dispose();
  }
});

test("4.22 with none selected, a roster entry marked undrawn is neither read nor drawn; selected, it is drawn in its own colour", async () => {
  const asked: string[][] = [];
  const reading = (session: string): SessionWindow => ({ session, at: "-", inView: [], opens: [], glimpses: [], compactions: 0 });
  const core = createKnowledgeCore("app", { reads: {
    windowReading: async (_project, session) => { asked.push(["one", session]); return reading(session); },
    windowReadings: async (project, sessions) => { asked.push([project, ...sessions]); return sessions.map(reading); },
  } });
  const a = { session: "a", label: "A", colour: "hsl(1, 80%, 68%)", members: ["a", "a-child"] };
  const b = { session: "b", label: "B", colour: "hsl(2, 80%, 68%)", members: ["b"], undrawn: true as const };
  try {
    core.showRoster([a, b]);
    assert.deepEqual(asked, [["app", "a", "a-child"]], "the undrawn session's window is not read");
    assert.deepEqual(drawnRoster([a, b], undefined), [a], "nor drawn");
    core.select("b");
    assert.deepEqual(asked.at(-1), ["one", "b"], "selected, its window is read");
    assert.deepEqual(drawnRoster([a, b], "b"), [a, b], "and it keeps its colour");
  } finally {
    core.dispose();
  }
});
