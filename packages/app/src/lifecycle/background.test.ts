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

test("1.7 a start that arrives while the app is quitting is not lost: once the database has stopped, the app opens again with its window", async () => {
  const done: string[] = [];
  let finishStopping = (): void => {};
  const app = background({
    stopDatabase: () => new Promise<void>((resolve) => (finishStopping = resolve)),
    exit: (code) => done.push(`exit ${code}`),
    relaunch: (target, inBackground) => done.push(`relaunch ${target === undefined ? "itself" : target.args.join(" ")}${inBackground ? " in the background" : " with its window"}`),
  });

  assert.equal(app.secondStart(), "show", "while it runs, a second start shows the window");
  const quitting = app.quit();
  assert.equal(app.secondStart(), "reopen", "while it is quitting, a second start is held for later");
  finishStopping();
  await quitting;
  assert.deepEqual(done, ["relaunch itself with its window", "exit 0"], "and the app opens again, with its window, once it has stopped");
});

test("1.7 restarting into an update stops the database once, and the new build shows its window only if it was showing or the app was started again meanwhile", async () => {
  const runs = async (showing: boolean, startedAgain: boolean): Promise<string[]> => {
    const done: string[] = [];
    let finishStopping = (): void => {};
    const app = background({
      stopDatabase: () => {
        done.push("database stopping");
        return new Promise<void>((resolve) => (finishStopping = resolve));
      },
      exit: (code) => done.push(`exit ${code}`),
      relaunch: (target, inBackground) => done.push(`relaunch ${target?.args.join(" ")}${inBackground ? " in the background" : " with its window"}`),
    });
    const restarting = app.restart({ execPath: "b/electron", args: ["b/app"] }, showing);
    if (startedAgain) assert.equal(app.secondStart(), "reopen");
    finishStopping();
    await restarting;
    return done;
  };
  assert.deepEqual(await runs(false, false), ["database stopping", "relaunch b/app in the background", "exit 0"]);
  assert.deepEqual(await runs(true, false), ["database stopping", "relaunch b/app with its window", "exit 0"]);
  assert.deepEqual(await runs(false, true), ["database stopping", "relaunch b/app with its window", "exit 0"], "a start during the restart is not swallowed");
});
