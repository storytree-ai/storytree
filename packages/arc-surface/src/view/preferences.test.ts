import assert from "node:assert/strict";
import { test } from "node:test";
import { readPreferences, restorePick, writePreferences } from "./preferences.js";

test("3.7 each project remembers its drawer between launches, a vanished arc falls back to the briefing, and closing keeps scope and selection", () => {
  const saved = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) } });
  try {
    writePreferences("alpha", { open: true, scope: "parked", picked: "arc-b" });
    writePreferences("beta", { open: false, scope: "closed", picked: "arc-z" });
    assert.deepEqual(readPreferences("alpha"), { open: true, scope: "parked", picked: "arc-b" });
    assert.deepEqual(readPreferences("beta"), { open: false, scope: "closed", picked: "arc-z" });
    assert.deepEqual(readPreferences("gamma"), { open: false, scope: "active" });

    assert.equal(restorePick(["arc-a", "arc-b"], "arc-b", "arc-a"), "arc-b");
    assert.equal(restorePick(["arc-a"], "arc-b", "arc-a"), "arc-a");
    assert.equal(restorePick([], "arc-b", undefined), undefined);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
