import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { signIn, type LoginItem } from "./sign-in.js";

/** Electron's login item, faked: what each call asked for. */
function fakeLoginItems(): { calls: LoginItem[]; set(item: LoginItem): void } {
  const calls: LoginItem[] = [];
  return { calls, set: (item) => { calls.push(item); } };
}

test("1.12 the installed app opens at sign-in, straight to the tray, until the user turns it off, and the choice outlasts a restart", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "sign-in-")), "sign-in.json");
  const items = fakeLoginItems();

  const first = signIn({ installed: true, file, loginItems: items });
  first.apply();
  assert.deepEqual(items.calls, [{ openAtLogin: true, args: ["--background"], name: "storytree 0.3" }]);
  assert.deepEqual(first.read(), { available: true, on: true });

  assert.deepEqual(first.set(false), { available: true, on: false });
  assert.deepEqual(items.calls.at(-1), { openAtLogin: false, args: ["--background"], name: "storytree 0.3" });

  // The next start keeps the user's choice rather than registering again.
  const restarted = signIn({ installed: true, file, loginItems: items });
  restarted.apply();
  assert.equal(items.calls.at(-1)?.openAtLogin, false);
  assert.deepEqual(restarted.read(), { available: true, on: false });
  assert.deepEqual(restarted.set(true), { available: true, on: true });
  assert.equal(items.calls.at(-1)?.openAtLogin, true);
});

test("1.12 a development copy, portable build or runtime slot never registers itself to open at sign-in", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "sign-in-")), "sign-in.json");
  const items = fakeLoginItems();
  const notInstalled = signIn({ installed: false, file, loginItems: items });
  notInstalled.apply();
  assert.deepEqual(notInstalled.read(), { available: false, on: false });
  assert.throws(() => notInstalled.set(true), /installed/);
  assert.deepEqual(items.calls, []);
});
