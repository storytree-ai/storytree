import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { installChoice, nextInstallAt } from "./install-choice.js";

const fileIn = () => path.join(mkdtempSync(path.join(tmpdir(), "install-choice-")), "install-choice.json");

test("4.13 the user's install choice is kept in the app's home and outlasts a restart", () => {
  const file = fileIn();
  const first = installChoice({ available: true, file });
  assert.deepEqual(first.read(), { available: true, choice: { mode: "quiet" } });
  assert.deepEqual(first.set({ mode: "hours", from: "01:00", to: "06:00" }), { available: true, choice: { mode: "hours", from: "01:00", to: "06:00" } });
  assert.deepEqual(installChoice({ available: true, file }).read().choice, { mode: "hours", from: "01:00", to: "06:00" });
  first.set({ mode: "manual" });
  assert.deepEqual(installChoice({ available: true, file }).read().choice, { mode: "manual" });
});

test("4.13 a choice that is not one is refused with its reason, and the kept one stands", () => {
  const file = fileIn();
  const choices = installChoice({ available: true, file });
  choices.set({ mode: "manual" });
  for (const wrong of [{ mode: "hours", from: "25:00", to: "06:00" }, { mode: "hours", from: "06:00", to: "06:00" }, { mode: "sometimes" }, "manual"]) {
    assert.throws(() => choices.set(wrong), /./);
  }
  assert.deepEqual(choices.read().choice, { mode: "manual" });
  writeFileSync(file, "{ not json");
  assert.deepEqual(choices.read().choice, { mode: "quiet" }, "an unreadable choice reads as the default");
  assert.throws(() => installChoice({ available: false, file: fileIn() }).set({ mode: "manual" }), /installed/);
  assert.equal(readFileSync(file, "utf8"), "{ not json");
});

test("4.14 the next automatic install opens at the quiet hours' start, or now inside them; never for manual only", () => {
  const at = (clock: string) => new Date(2026, 9, 2, Number(clock.slice(0, 2)), Number(clock.slice(3)));
  const hours = { mode: "hours", from: "23:00", to: "06:00" } as const;
  assert.deepEqual(nextInstallAt(hours, at("12:00")), at("23:00"));
  assert.deepEqual(nextInstallAt(hours, at("02:00")), at("02:00"));
  assert.deepEqual(nextInstallAt({ mode: "hours", from: "01:00", to: "06:00" }, at("12:00")), new Date(2026, 9, 3, 1, 0));
  assert.equal(nextInstallAt({ mode: "manual" }, at("12:00")), undefined);
  assert.deepEqual(nextInstallAt({ mode: "quiet" }, at("12:00")), at("12:00"));
});
