import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { iconPath, readPng, renderMark } from "@storytree/mark";

import { followTaskbar, iconColourway, markIcon } from "./app-icon.js";

/** A stand-in for Electron's nativeTheme: its two readings, and its "updated" event. */
function theme(systemDark: boolean | undefined, appDark: boolean) {
  return Object.assign(new EventEmitter(), { shouldUseDarkColorsForSystemIntegratedUI: systemDark, shouldUseDarkColors: appDark });
}

test("1.17 · the tray and window take the night colourway on a dark taskbar and the day colourway otherwise", () => {
  assert.equal(iconColourway(theme(true, false)), "night", "the taskbar's own setting wins over the apps' one");
  assert.equal(iconColourway(theme(false, true)), "day");
  // Where Electron reports no taskbar setting (Linux), the apps' one is read.
  assert.equal(iconColourway(theme(undefined, true)), "night");
  assert.equal(iconColourway(theme(undefined, false)), "day");
});

test("1.17 · the icon is the mark's own rendering, at every size it is asked for", () => {
  const icon = markIcon("night", [16, 32]);
  assert.deepEqual(icon.map((entry) => entry.size), [16, 32]);
  for (const { size, png } of icon) {
    const read = readPng(png);
    assert.equal(read.width, size);
    assert.deepEqual(read.pixels, renderMark("night", size), `the ${size}-pixel icon is the night mark`);
  }
});

test("1.17 · a change of the taskbar's setting while running changes the icon, and only a change", () => {
  const os = theme(false, false);
  const worn: string[] = [];
  followTaskbar(os, (colourway) => worn.push(colourway));
  assert.deepEqual(worn, ["day"], "worn at once");
  os.shouldUseDarkColorsForSystemIntegratedUI = true;
  os.emit("updated");
  os.emit("updated");
  assert.deepEqual(worn, ["day", "night"], "a repeated reading is not worn again");
  os.shouldUseDarkColorsForSystemIntegratedUI = false;
  os.emit("updated");
  assert.deepEqual(worn, ["day", "night", "day"]);
});

test("1.17 · the installer, the Windows app and the macOS bundle carry the mark's day colourway files", () => {
  const desktop = path.join(import.meta.dirname, "..", "..");
  const { build } = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8"));
  const file = (relative: string) => readFileSync(path.resolve(desktop, relative));
  const ico = readFileSync(iconPath("day", "mark.ico"));
  assert.deepEqual(file(build.win.icon), ico, "the Windows app");
  assert.deepEqual(file(build.nsis.installerIcon), ico, "the installer");
  assert.deepEqual(file(build.nsis.uninstallerIcon), ico, "the uninstaller");
  assert.deepEqual(file(build.mac.icon), readFileSync(iconPath("day", "mark.icns")), "the macOS bundle");
});
