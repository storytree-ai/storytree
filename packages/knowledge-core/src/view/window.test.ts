/** Capability 4 · 4.16: the core reads a selected session's window from its host, and only that session's. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionWindow } from "@storytree/agent-link";

import { createKnowledgeCore } from "./surface.js";

test("4.16 selecting a session asks the host for its window; one answered after the selection moved on is dropped, and going back to every session shows none", async () => {
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
