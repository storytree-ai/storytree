import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loginItemsFor, SIGN_IN_LABEL, signIn, type LoginItem } from "./sign-in.js";

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

test("1.12 on a Mac, opening at sign-in is a LaunchAgent that starts the app with --background, which Electron's login item cannot pass there", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sign-in-"));
  const launchAgents = path.join(dir, "LaunchAgents");
  const electron = fakeLoginItems();
  const execPath = "/Applications/storytree-0.3.app/Contents/MacOS/storytree-0.3";
  const mac = signIn({ installed: true, file: path.join(dir, "sign-in.json"), loginItems: loginItemsFor("darwin", { electron, execPath, launchAgents }) });
  const agent = path.join(launchAgents, `${SIGN_IN_LABEL}.plist`);

  mac.apply();
  const plist = readFileSync(agent, "utf8");
  assert.match(plist, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/Applications\/storytree-0\.3\.app\/Contents\/MacOS\/storytree-0\.3<\/string>\s*<string>--background<\/string>\s*<\/array>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  // An update relaunches the app from it: launchd must not stop that new start when this one quits.
  assert.match(plist, /<key>AbandonProcessGroup<\/key>\s*<true\/>/);
  // Electron's own Mac login item, which would open the window, is never left registered.
  assert.ok(electron.calls.every((call) => !call.openAtLogin));

  mac.set(false);
  assert.equal(existsSync(agent), false);
  mac.set(true);
  assert.equal(existsSync(agent), true);
});

test("1.12 on Windows, opening at sign-in stays Electron's login item, which passes --background", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sign-in-"));
  const electron = fakeLoginItems();
  const launchAgents = path.join(dir, "LaunchAgents");
  signIn({ installed: true, file: path.join(dir, "sign-in.json"), loginItems: loginItemsFor("win32", { electron, execPath: "C:\\storytree.exe", launchAgents }) }).apply();
  assert.deepEqual(electron.calls, [{ openAtLogin: true, args: ["--background"], name: "storytree 0.3" }]);
  assert.equal(existsSync(launchAgents), false);
});
