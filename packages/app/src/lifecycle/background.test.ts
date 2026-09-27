/**
 * Capability 1 · Lifecycle: the app keeps running in the background, contract 1.7 in
 * the app story (ADR-0636 D3). It is plain logic, apart from Electron, so it is tested without it;
 * apps/desktop wires it to the window's close, the tray's menu and a second start of the app.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { background, TRAY_MENU } from "./background.js";

test("1.7 closing the window leaves the app and its database running, and the tray's Quit is the one way to stop them", async () => {
  const done: string[] = [];
  let finishStopping = (): void => {};
  const app = background({
    stopDatabase: () => {
      done.push("database stopping");
      return new Promise<void>((resolve) => (finishStopping = resolve));
    },
    exit: (code) => done.push(`exit ${code}`),
  });

  assert.equal(app.windowClosed(), "keep-running", "closing the window keeps the app running");
  assert.deepEqual(done, [], "and nothing is stopped");

  assert.deepEqual(
    TRAY_MENU.filter((item) => item.stops),
    [{ id: "quit", label: "Quit storytree 0.3", stops: true }],
    "the tray's menu has one item that stops the app: Quit",
  );
  assert.ok(TRAY_MENU.some((item) => item.id === "show" && !item.stops), "and one that shows the window again");

  const quitting = app.quit();
  const again = app.quit();
  assert.deepEqual(done, ["database stopping"], "Quit stops the database once, however often it is asked");
  finishStopping();
  await Promise.all([quitting, again]);
  assert.deepEqual(done, ["database stopping", "exit 0"], "and the app exits only after the database has stopped");
});
