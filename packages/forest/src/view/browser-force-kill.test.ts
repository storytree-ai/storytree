/**
 * Capability 3 · Story node render: ending a real browser never force-kills by a pid once that browser's process has exited
 * (3.123). Playwright's launcher, as storytree installs it, is driven with a stand-in browser whose helper outlives it holding
 * its pipes, as a Chrome helper does on a loaded Windows runner, and its force kill is read on the Windows path.
 */
import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { removeTemp, waitUntil } from "@storytree/test-waits";

/** The part of Playwright's launcher the test drives: `utils.launchProcess`, which every browser launch goes through. */
type Launched = { launchedProcess: ChildProcess; kill(): Promise<void> };
type LaunchProcess = (options: {
  command: string; args: string[]; stdio: "pipe"; env: NodeJS.ProcessEnv; tempDirectories: string[];
  attemptToGracefullyClose(): Promise<void>; log(line: string): void; onExit(code: number | null, signal: string | null): void;
}) => Promise<Launched>;
const { utils } = createRequire(import.meta.url)("playwright-core/lib/coreBundle") as { utils: { launchProcess: LaunchProcess } };

/** Launch a stand-in browser running `script` the way Playwright launches Chrome, watching its 'exit' and its 'close'. */
async function launch(script: string) {
  const launched = await utils.launchProcess({
    command: process.execPath, args: ["-e", script], stdio: "pipe", env: process.env, tempDirectories: [],
    attemptToGracefullyClose: async () => { throw new Error("the stand-in has no protocol to close it by"); },
    log: () => {}, onExit: () => {},
  });
  const seen = { exited: false, closed: false };
  launched.launchedProcess.on("exit", () => { seen.exited = true; });
  launched.launchedProcess.on("close", () => { seen.closed = true; });
  return { ...launched, seen };
}

/** Call `kill` with the platform read as Windows and `spawnSync` caught, and return each command it asked to run. */
function killOnWindows(t: TestContext, kill: () => Promise<void>): { asked: string[]; ended: Promise<void> } {
  const asked: string[] = [];
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const caught = t.mock.method(childProcess, "spawnSync", (command: string) => {
    asked.push(command);
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  });
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    return { asked, ended: kill() };
  } finally {
    Object.defineProperty(process, "platform", platform);
    caught.mock.restore();
  }
}

test("3.123 · Playwright's kill asks taskkill for a live browser's pid, and asks nothing once that browser has exited or been killed by a signal while its helper still holds its pipes", async t => {
  const folder = await mkdtemp(path.join(tmpdir(), "forest-force-kill-"));
  t.after(() => removeTemp(folder));

  // The control: a browser still running is force-killed by its pid.
  const live = await launch("setInterval(() => {}, 1000)");
  const livePid = live.launchedProcess.pid;
  const onLive = killOnWindows(t, live.kill);
  live.launchedProcess.kill();
  await onLive.ended;
  assert.deepEqual(onLive.asked, [`taskkill /pid ${livePid} /T /F`], "the live browser's kill asks taskkill for its pid");

  // A helper the browser leaves behind on its stdout and stderr, which ends once the test removes its marker (or after two minutes).
  // The browser then ends by itself, by exiting or by a signal (on Windows a self-kill reads as exit code 1).
  for (const [ending, end] of [["exits", ""], ["is killed by a signal", `process.kill(process.pid, "SIGKILL");`]] as const) {
    const marker = path.join(folder, `helper-may-live-${end === "" ? "exit" : "signal"}`);
    await writeFile(marker, "");
    const helper = `setInterval(() => { if (!require("node:fs").existsSync(${JSON.stringify(marker)})) process.exit(0); }, 100);
      setTimeout(() => process.exit(0), 120000);`;
    const ended = await launch(`require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(helper)}],
      { detached: true, stdio: ["ignore", "inherit", "inherit"] }).unref(); ${end}`);
    try {
      await waitUntil(() => ended.seen.exited, 15_000, `the stand-in browser's process that ${ending} to end`);
      assert.equal(ended.seen.closed, false, `the helper still holds the pipes of the browser that ${ending}, so its 'close' has not come`);
      const onEnded = killOnWindows(t, ended.kill);
      assert.deepEqual(onEnded.asked, [], `the kill of the browser that ${ending} asks nothing, never taskkill for pid ${ended.launchedProcess.pid}`);
      onEnded.ended.catch(() => {});
    } finally {
      await removeTemp(marker);
      await waitUntil(() => ended.seen.closed, 15_000, `the helper to end and the pipes of the browser that ${ending} to close`);
    }
  }
});
