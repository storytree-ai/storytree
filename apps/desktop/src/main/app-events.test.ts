import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { answerAppEvents, answerCallbackCheckEvents } from "./app-events.js";

/** A stand-in for an event Electron hands a listener, which records whether its default was prevented. */
function event() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

/** A stand-in for the app's lifecycle (@storytree/app's background): each answer it gave, and what it was asked. */
function lifecycle(secondStart: "show" | "reopen" | "quit" = "show") {
  const asked: string[] = [];
  return {
    asked,
    secondStart: (request?: { quit?: boolean }) => { asked.push(`second start${request?.quit ? " --quit" : ""}`); return secondStart; },
    windowClosed: () => { asked.push("window closed"); return "keep-running" as const; },
    quit: async () => { asked.push("quit"); },
  };
}

test("1.7 · closing the last window leaves the app running; quitting waits for the lifecycle's stop instead of ending at once, and a signal asks the app to quit", () => {
  const app = new EventEmitter(), signals = new EventEmitter();
  const life = lifecycle();
  const quits: string[] = [];
  answerAppEvents(app, signals, { deliver: () => {}, lifecycle: life, showWindow: () => {}, quitApp: () => quits.push("app.quit") });
  app.emit("window-all-closed");
  const quitting = event();
  app.emit("before-quit", quitting);
  signals.emit("SIGTERM");
  assert.equal(quitting.prevented, true, "Electron's own quit is held while the lifecycle stops the database");
  assert.deepEqual(life.asked, ["window closed", "quit"]);
  assert.deepEqual(quits, ["app.quit"]);
});

test("1.27 · a second start shows the window unless the lifecycle holds it, and the dock's activate shows it", () => {
  const app = new EventEmitter(), signals = new EventEmitter();
  const shown: string[] = [];
  answerAppEvents(app, signals, { deliver: () => {}, lifecycle: lifecycle("show"), showWindow: () => shown.push("shown"), quitApp: () => {} });
  app.emit("second-instance", event(), ["electron", "."]);
  app.emit("activate");
  assert.deepEqual(shown, ["shown", "shown"]);

  const held = new EventEmitter();
  const life = lifecycle("reopen");
  const heldShown: string[] = [];
  answerAppEvents(held, new EventEmitter(), { deliver: () => {}, lifecycle: life, showWindow: () => heldShown.push("shown"), quitApp: () => {} });
  held.emit("second-instance", event(), ["electron", ".", "--quit"]);
  assert.deepEqual(heldShown, [], "a start the lifecycle holds for a reopen opens no window now");
  assert.deepEqual(life.asked, ["second start --quit"]);
});

test("1.15 · a sign-in callback reaches the app as a second start's argument or as open-url, whose default is prevented", () => {
  const app = new EventEmitter();
  const delivered: string[] = [];
  answerAppEvents(app, new EventEmitter(), { deliver: url => delivered.push(url), lifecycle: lifecycle(), showWindow: () => {}, quitApp: () => {} });
  app.emit("second-instance", event(), ["electron", ".", "storytree-auth://callback?code=a&state=b"]);
  const opened = event();
  app.emit("open-url", opened, "storytree-auth://callback?code=c&state=d");
  assert.deepEqual(delivered, ["storytree-auth://callback?code=a&state=b", "storytree-auth://callback?code=c&state=d"]);
  assert.equal(opened.prevented, true);
});

test("1.15 · a --callback-check start hands over each callback a later start brings, and ends on a later --quit or a signal", () => {
  const app = new EventEmitter(), signals = new EventEmitter();
  const delivered: string[] = [], exits: number[] = [];
  answerCallbackCheckEvents(app, signals, { deliver: url => delivered.push(url), exit: code => exits.push(code) });
  app.emit("second-instance", event(), ["electron", ".", "storytree-auth://callback?code=a&state=b"]);
  assert.deepEqual(exits, [], "a start that hands a callback over does not end the check");
  app.emit("open-url", event(), "storytree-auth://callback?code=c&state=d");
  app.emit("second-instance", event(), ["electron", ".", "--quit"]);
  signals.emit("SIGINT");
  assert.deepEqual(delivered, ["storytree-auth://callback?code=a&state=b", "storytree-auth://callback?code=c&state=d"]);
  assert.deepEqual(exits, [0, 0]);
});

test("1.39 · a second start carrying a sign-in link with --quit hands the link over and quits nothing", () => {
  const app = new EventEmitter(), checking = new EventEmitter();
  const life = lifecycle();
  const delivered: string[] = [], exits: number[] = [];
  answerAppEvents(app, new EventEmitter(), { deliver: url => delivered.push(url), lifecycle: life, showWindow: () => {}, quitApp: () => {} });
  app.emit("second-instance", event(), ["electron", ".", "--quit", "storytree-auth://callback?code=a&state=b"]);
  assert.deepEqual(life.asked, ["second start"]);
  answerCallbackCheckEvents(checking, new EventEmitter(), { deliver: url => delivered.push(url), exit: code => exits.push(code) });
  checking.emit("second-instance", event(), ["electron", ".", "storytree-auth://callback?code=c&state=d", "--quit"]);
  assert.deepEqual(exits, []);
  assert.equal(delivered.length, 2);
});
