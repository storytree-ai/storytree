/**
 * Capability 4 · Updates, contracts 4.30 to 4.33: how an installed app follows its releases, and the version it
 * reports. The updater is a stand-in whose checks answer as each test says.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { agentToolsFolder, channelOffered, keepCheckingReleases, RELEASE_CHECK_EVERY_MS } from "./follow-releases.js";
import { appVersion } from "./version.js";

test("4.30 a following app checks for a release at start and every three minutes until it quits; a failed check is logged and the next goes ahead, and a waiting release says when it installs", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const answers: Array<string | Error> = ["none", new Error("offline"), "waiting"];
  const lines: string[] = [];
  let checks = 0;
  let stopped = false;
  const checking = keepCheckingReleases({
    updater: {
      check: async () => {
        const answer = answers[checks++] ?? "none";
        if (answer instanceof Error) throw answer;
        return answer;
      },
      stop: () => { stopped = true; },
    },
    log: { info: (line) => lines.push(line), error: (error) => lines.push(`error: ${(error as Error).message}`) },
    waiting: () => "installs at the next quiet moment",
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  assert.equal(checks, 1, "it checks as it starts");
  t.mock.timers.tick(RELEASE_CHECK_EVERY_MS - 1);
  await settle();
  assert.equal(checks, 1, "and not again before three minutes");
  t.mock.timers.tick(1);
  await settle();
  t.mock.timers.tick(RELEASE_CHECK_EVERY_MS);
  await settle();
  assert.equal(checks, 3, "a failed check does not stop the next");
  assert.deepEqual(lines, ["error: offline", "installs at the next quiet moment"]);
  assert.equal(RELEASE_CHECK_EVERY_MS, 180_000);

  checking.stop();
  assert.equal(stopped, true, "quitting stops the updater");
  t.mock.timers.tick(RELEASE_CHECK_EVERY_MS * 3);
  await settle();
  assert.equal(checks, 3, "and no check runs after it");
});

test("4.31 only an installed Linux AppImage refreshes the agent tools beside it", () => {
  assert.equal(agentToolsFolder({ platform: "linux", appImage: "/home/u/Applications/storytree.AppImage" }), path.dirname("/home/u/Applications/storytree.AppImage"));
  assert.equal(agentToolsFolder({ platform: "linux", appImage: undefined }), undefined, "a Linux app that is not an AppImage refreshes none");
  assert.equal(agentToolsFolder({ platform: "win32", appImage: "C:\\storytree.AppImage" }), undefined);
  assert.equal(agentToolsFolder({ platform: "darwin", appImage: undefined }), undefined);
});

test("4.32 the gear offers the update channel only where releases install themselves, and never in a smoke check", () => {
  assert.equal(channelOffered({ smoke: false, followsReleases: true }), true);
  assert.equal(channelOffered({ smoke: false, followsReleases: false }), false);
  assert.equal(channelOffered({ smoke: true, followsReleases: true }), false);
});

test("4.33 the running app reports Electron's version when packaged, else its checkout's, else 0.3.0", () => {
  const source = (from: string) => from === "/checkout" ? { version: "0.3.57" } : undefined;
  assert.equal(appVersion({ packaged: true, packagedVersion: () => "0.3.60", appPath: "/checkout", source }), "0.3.60");
  assert.equal(appVersion({ packaged: false, packagedVersion: () => "0.3.60", appPath: "/checkout", source }), "0.3.57");
  assert.equal(appVersion({ packaged: false, packagedVersion: () => "0.3.60", appPath: "/elsewhere", source }), "0.3.0");
});
