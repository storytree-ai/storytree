import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { TRAY_MENU } from "@storytree/app";

import { keepTray, type AppTray, type IconWindow } from "./tray.js";

/** A stand-in for Electron's nativeTheme on a taskbar that is dark or light. */
function theme(dark: boolean) {
  return Object.assign(new EventEmitter(), { shouldUseDarkColors: dark, shouldUseDarkColorsForSystemIntegratedUI: dark });
}

/** A stand-in for Electron's tray or window: what it wears, and every call throws once it is destroyed, as theirs do. */
function worn() {
  let destroyed = false;
  const images: string[] = [];
  const guard = () => { if (destroyed) throw new TypeError("Object has been destroyed"); };
  return { images, isDestroyed: () => destroyed, destroy: () => { destroyed = true; }, guard };
}

function fakeTray() {
  const state = worn();
  const clicks = new EventEmitter();
  let menu: { label: string; click: () => void }[] = [];
  const tray: AppTray<string, typeof menu> = {
    isDestroyed: state.isDestroyed,
    setImage: (image) => { state.guard(); state.images.push(image); },
    setToolTip: () => state.guard(),
    setContextMenu: (items) => { state.guard(); menu = items; },
    on: (_event, listener) => { clicks.on("click", listener); },
  };
  return { ...state, tray, click: () => clicks.emit("click"), menu: () => menu };
}

function fakeWindow(): ReturnType<typeof worn> & { window: IconWindow<string> } {
  const state = worn();
  return { ...state, window: { isDestroyed: state.isDestroyed, setIcon: (image) => { state.guard(); state.images.push(image); } } };
}

/** The tray kept with these stand-ins: what it wears, the windows', and what its clicks asked for. */
function kept(taskbar: ReturnType<typeof theme>, windows: ReturnType<typeof fakeWindow>[]) {
  const made = fakeTray();
  const asked: string[] = [];
  keepTray({
    theme: taskbar, items: TRAY_MENU, build: "main abc123",
    makeTray: (image) => { made.images.push(image); return made.tray; },
    trayIcon: (colourway) => `tray ${colourway}`,
    windowIcon: (colourway) => `window ${colourway}`,
    windows: () => windows.map((one) => one.window),
    buildMenu: (items) => items,
    show: () => asked.push("show"),
    quit: () => asked.push("quit"),
  });
  return { made, asked };
}

test("1.17 · the tray and the windows change colourway with the taskbar, leaving a destroyed window or tray alone", () => {
  const taskbar = theme(false);
  const live = fakeWindow(), closed = fakeWindow();
  const { made } = kept(taskbar, [live, closed]);
  closed.destroy();
  taskbar.shouldUseDarkColorsForSystemIntegratedUI = true;
  assert.doesNotThrow(() => taskbar.emit("updated"));
  assert.deepEqual(made.images, ["tray day", "tray night"]);
  assert.deepEqual(live.images, ["window day", "window night"]);
  assert.deepEqual(closed.images, ["window day"]);

  made.destroy();
  taskbar.shouldUseDarkColorsForSystemIntegratedUI = false;
  assert.doesNotThrow(() => taskbar.emit("updated"));
  assert.deepEqual(live.images, ["window day", "window night", "window day"]);
});

test("1.27 · clicking the tray, or its Open, brings the window back; 1.7 · its Quit quits the app", () => {
  const { made, asked } = kept(theme(true), []);
  made.click();
  const [open, quit] = made.menu();
  assert.deepEqual(made.menu().map((item) => item.label), ["Open storytree 0.3", "Quit storytree 0.3"]);
  open!.click();
  quit!.click();
  assert.deepEqual(asked, ["show", "show", "quit"]);
});
