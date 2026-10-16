import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loginItemsFor, SIGN_IN_DESKTOP_FILE, SIGN_IN_LABEL, signIn, type LoginItem } from "./sign-in.js";

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
  const mac = signIn({ installed: true, file: path.join(dir, "sign-in.json"), loginItems: loginItemsFor("darwin", { electron, execPath, launchAgents, autostart: path.join(dir, "autostart") }) });
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
  signIn({ installed: true, file: path.join(dir, "sign-in.json"), loginItems: loginItemsFor("win32", { electron, execPath: "C:\\storytree.exe", launchAgents, autostart: path.join(dir, "autostart") }) }).apply();
  assert.deepEqual(electron.calls, [{ openAtLogin: true, args: ["--background"], name: "storytree 0.3" }]);
  assert.equal(existsSync(launchAgents), false);
  assert.equal(existsSync(path.join(dir, "autostart")), false);
});

test("1.12 on Linux, opening at sign-in is an XDG autostart entry that starts the installed AppImage with --background, which Electron's login item cannot register there", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sign-in-"));
  const autostart = path.join(dir, "autostart");
  const electron = fakeLoginItems();
  const execPath = "/home/someone/My Apps/storytree-0.3";
  const linux = signIn({ installed: true, file: path.join(dir, "sign-in.json"), loginItems: loginItemsFor("linux", { electron, execPath, launchAgents: path.join(dir, "LaunchAgents"), autostart }) });
  const entry = path.join(autostart, SIGN_IN_DESKTOP_FILE);

  linux.apply();
  const desktop = readFileSync(entry, "utf8");
  assert.match(desktop, /^\[Desktop Entry\]$/m);
  assert.match(desktop, /^Type=Application$/m);
  // A path with a space is quoted, as the desktop entry spec asks, so the session starts the AppImage itself.
  assert.match(desktop, /^Exec="\/home\/someone\/My Apps\/storytree-0\.3" --background$/m);
  assert.equal(electron.calls.length, 0);

  linux.set(false);
  assert.equal(existsSync(entry), false);
  linux.set(true);
  assert.equal(existsSync(entry), true);
});

test("1.12 on Linux, an app the menu entry started without the sandbox, where the kernel blocks it, opens at sign-in without it too", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sign-in-"));
  const autostart = path.join(dir, "autostart");
  const loginItems = loginItemsFor("linux", { electron: fakeLoginItems(), execPath: "/opt/storytree-0.3", launchAgents: path.join(dir, "LaunchAgents"), autostart, sandboxOff: true });
  signIn({ installed: true, file: path.join(dir, "sign-in.json"), loginItems }).apply();
  assert.match(readFileSync(path.join(autostart, SIGN_IN_DESKTOP_FILE), "utf8"), /^Exec=\/opt\/storytree-0\.3 --no-sandbox --background$/m);
});
