import assert from "node:assert/strict";
import { test } from "node:test";
import { readPreferences, writePreferences } from "./preferences.js";

test("3.7 each project remembers its arcs' scope between launches, and keeps no picked arc to reopen", () => {
  const saved = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) } });
  try {
    writePreferences("alpha", { scope: "parked" });
    writePreferences("beta", { scope: "closed" });
    assert.deepEqual(readPreferences("alpha"), { scope: "parked" });
    assert.deepEqual(readPreferences("beta"), { scope: "closed" });
    assert.deepEqual(readPreferences("gamma"), { scope: "active" });
    // A value kept by the drawer before the rail: its open state, picked arc and size are read no more.
    saved.set("storytree.arc-surface.v1:alpha", '{"open":true,"scope":"parked","picked":"arc-b","expanded":true}');
    assert.deepEqual(readPreferences("alpha"), { scope: "parked" });
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
