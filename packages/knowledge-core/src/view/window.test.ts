/** Capability 4 · 4.16: the core reads a selected session's window from its host, and only that session's. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionWindow } from "@storytree/session-management";

import { createKnowledgeCore } from "./surface.js";

test("4.16 selecting a session asks the host for its window; one answered after the selection moved on is dropped, and deselecting shows none", async () => {
  const asked: string[] = [];
  const answers = new Map<string, (window: SessionWindow) => void>();
  const core = createKnowledgeCore("app", { reads: { windowReading: (project, session) => {
    asked.push(`${project} ${session}`);
    return new Promise((resolve) => answers.set(session, resolve));
  } } });
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

test("4.18 with none selected, showing the listed sessions asks the host for no window; selecting one asks for its window alone", async () => {
  const asked: string[] = [];
  const reading = (session: string): SessionWindow => ({ session, at: "-", inView: [], opens: [], glimpses: [], compactions: 0 });
  const core = createKnowledgeCore("app", { reads: { windowReading: async (_project, session) => { asked.push(session); return reading(session); } } });
  const a = { session: "a", label: "A", colour: "hsl(1, 80%, 68%)", members: ["a", "a-child"] };
  const b = { session: "b", label: "B", colour: "hsl(2, 80%, 68%)", members: ["b"] };
  try {
    core.showRoster([a, b]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(asked, [], "no window is read with none selected");
    core.select("b");
    core.showRoster([a, b]);
    assert.deepEqual(asked, ["b"], "the selected session's alone");
  } finally {
    core.dispose();
  }
});

test("4.16, 4.23 a failed read of the selected session's window, or of the factory's notes, keeps what was shown and writes the failure to the console, so app.log", async (t) => {
  let bothLogged!: () => void;
  const logs = new Promise<void>((resolve) => { bothLogged = resolve; });
  const logged = t.mock.method(console, "error", () => { if (logged.mock.callCount() === 1) bothLogged(); });
  const core = createKnowledgeCore("app", { reads: {
    windowReading: async () => { throw new Error("the window was not read"); },
    inherited: async () => { throw new Error("the factory did not answer"); },
  } });
  try {
    core.select("S");
    await logs;
    assert.equal((core as unknown as { get(): { window: SessionWindow | undefined } }).get().window, undefined);
    assert.deepEqual(logged.mock.calls.map((call) => [call.arguments[0], (call.arguments[1] as Error).message]), [
      ["knowledge-core: the factory's notes could not be read", "the factory did not answer"],
      ["knowledge-core: the selected session's window could not be read", "the window was not read"],
    ]);
  } finally {
    core.dispose();
  }
});
