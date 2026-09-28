/**
 * Capability 1 · Lifecycle, contract 1.7 (ADR-0656 D1): the app can be asked to quit from outside
 * (`storytree app quit`), as the tray's Quit does. The request goes to the running app as a second
 * start with `--quit`, through the record of how to open it (app.json), and the answer comes once
 * its database has stopped. Stand-ins for the running app: its owner record, and its start.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { quitApp } from "./quit.js";

function home(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-quit-"));
  writeFileSync(path.join(dir, "app.json"), JSON.stringify({ command: "slot/electron.exe", args: ["slot/app"] }));
  return dir;
}

test("1.7 asking the running app to quit sends it --quit and answers once its database has stopped", async () => {
  const dir = home();
  try {
    let running = true;
    const opened: string[][] = [];
    const result = await quitApp({
      home: dir,
      locate: () => (running ? { running: true, url: "postgres://x" } : { running: false }),
      open: (command, args) => {
        opened.push([command, ...args]);
        setTimeout(() => (running = false), 20);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))),
    });
    assert.deepEqual(opened, [["slot/electron.exe", "slot/app", "--quit"]], "the app was asked, through its own launch, to quit");
    assert.equal(result.state, "quit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("1.7 asking a stopped app to quit starts nothing and says it is not running", async () => {
  const dir = home();
  try {
    const opened: string[][] = [];
    const result = await quitApp({ home: dir, locate: () => ({ running: false }), open: (command, args) => opened.push([command, ...args]) });
    assert.deepEqual(opened, [], "nothing was started");
    assert.equal(result.state, "not running");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("1.7 an app that does not stop in time is reported as still running, not as quit", async () => {
  const dir = home();
  try {
    let now = 0;
    const result = await quitApp({
      home: dir,
      locate: () => ({ running: true, url: "postgres://x" }),
      open: () => {},
      sleep: async (ms) => {
        now += ms;
      },
      clock: () => now,
      waitMs: 30_000,
    });
    assert.equal(result.state, "still running");
    assert.ok(now >= 30_000, "it waited the whole time first");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("1.11 with the library on Cloud SQL (no local database), the running app is found from its launch record and quit", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-quit-cloud-"));
  // A stand-in for the running app: a live process, named in app.json as the app records itself.
  const app = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    writeFileSync(path.join(dir, "app.json"), JSON.stringify({ command: "slot/electron.exe", args: ["slot/app"], pid: app.pid }));
    const opened: string[][] = [];
    const result = await quitApp({
      home: dir,
      open: (command, args) => {
        opened.push([command, ...args]);
        app.kill();
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20))),
    });
    assert.deepEqual(opened, [["slot/electron.exe", "slot/app", "--quit"]]);
    assert.equal(result.state, "quit");
    // Stopped, it reads as not running, and nothing is started.
    const again = await quitApp({ home: dir, open: (command, args) => opened.push([command, ...args]) });
    assert.equal(again.state, "not running");
    assert.equal(opened.length, 1);
  } finally {
    app.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
