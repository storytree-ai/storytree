/** Capability 3 · Keeping the host running, contracts 3.3 and 3.4: the laptop's storytree-host scheduled task, and `services install` / `services uninstall` registering and deleting it. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { requestStop, takeStop } from "../listing/status.js";
import { hostScript, hostTask, installTask, stopRunningHost, TASK_NAME, uninstallTask } from "./scheduled-task.js";

function tempDir(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-host-task-")));
  t.after(() => removeTemp(dir));
  return dir;
}

/** A stand-in node at `bin`\node.cmd that writes the folder it ran in and its arguments to `said`, ending 3 on its first run and 0 after. */
function fakeNode(bin: string, said: string): string {
  mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "node.cmd");
  writeFileSync(file, [
    "@echo off",
    `echo %CD%>> "${said}"`,
    `echo %*>> "${said}"`,
    `if exist "${said}.ran" exit /b 0`,
    `echo ran> "${said}.ran"`,
    "exit /b 3",
    "",
  ].join("\r\n"));
  return file;
}

test("3.3 · The laptop's storytree-host task runs node itself on `storytree services run` in storytree's checkout at the user's logon, windowless and with no time limit, starting it again after any end but a clean one", { skip: process.platform !== "win32" && "platform: a scheduled task is the Windows entry point" }, (t) => {
  const dir = tempDir(t);
  const checkout = path.join(dir, "storytree");
  mkdirSync(checkout);
  const system = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const run = (script: string, PATH: string) => execFileSync("cmd.exe", ["/d", "/c", script], { env: { ...process.env, PATH }, stdio: "ignore" });

  const said = path.join(dir, "said");
  const bin = path.join(dir, "bin");
  fakeNode(bin, said);
  const log = path.join(dir, "host.log");
  const script = path.join(dir, "storytree-host.cmd");
  writeFileSync(script, hostScript({ checkout, node: path.join(dir, "nowhere", "node.exe"), log, restartSeconds: 1 }));
  run(script, `${bin};${system}`);
  const lines = readFileSync(said, "utf8").trim().split(/\r?\n/);
  const args = "--import tsx packages\\cli\\src\\bins\\storytree.ts services run";
  assert.deepEqual(lines, [checkout, args, checkout, args], "the host ran as node itself in the checkout, again after it ended 3, and the script ended once it ended 0");
  assert.match(readFileSync(log, "utf8"), /ended with 3; starting it again/);

  const fallbackSaid = path.join(dir, "fallback-said");
  const fallback = fakeNode(path.join(dir, "fallback"), fallbackSaid);
  writeFileSync(fallbackSaid + ".ran", "ran");
  writeFileSync(script, hostScript({ checkout, node: fallback, log, restartSeconds: 1 }));
  run(script, system);
  assert.deepEqual(readFileSync(fallbackSaid, "utf8").trim().split(/\r?\n/), [checkout, args], "with no node on PATH, the node that installed the task runs the host");

  const task = hostTask(script, "LAPTOP\\mick");
  assert.match(task, /<LogonTrigger><Enabled>true<\/Enabled><UserId>LAPTOP\\mick<\/UserId><\/LogonTrigger>/, "it starts at this user's logon, not the desktop app's");
  assert.match(task, /<LogonType>InteractiveToken<\/LogonType><RunLevel>LeastPrivilege<\/RunLevel>/, "as the user, unelevated");
  assert.match(task, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/, "Task Scheduler's three-day limit would end it");
  assert.match(task, /<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/);
  assert.match(task, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/);
  assert.match(task, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/, "one host at a time");
  assert.ok(task.includes(`<Command>conhost.exe</Command><Arguments>--headless cmd.exe /d /c &quot;${script}&quot;</Arguments>`), "it runs the script with no window");
});

test("3.4 · storytree services install writes the script and registers the task, again idempotently, stopping a running host cleanly before a change; services uninstall stops the host, deletes the task and removes its files", async (t) => {
  const dir = tempDir(t);
  const calls: string[] = [];
  const scheduler = {
    dir,
    user: "LAPTOP\\mick",
    node: "C:\\node\\node.exe",
    schtasks: (args: readonly string[]) => { calls.push(args.join(" ")); },
    stopHost: async () => { calls.push("stop host"); },
  };
  const script = path.join(dir, "storytree-host.cmd");
  const xml = path.join(dir, "storytree-host.xml");

  assert.match(await installTask("C:\\code\\storytree03", scheduler), /^Registered the scheduled task storytree-host.*started/);
  assert.match(readFileSync(script, "utf8"), /^cd \/d "C:\\code\\storytree03"$/m);
  assert.match(readFileSync(xml, "utf16le"), /^\uFEFF<\?xml version="1\.0" encoding="UTF-16"\?>/, "schtasks reads the task as UTF-16, as it declares");
  assert.deepEqual(calls.splice(0), ["stop host", `/Create /TN ${TASK_NAME} /XML ${xml} /F`, `/Run /TN ${TASK_NAME}`]);

  assert.match(await installTask("C:\\code\\storytree03", scheduler), /already installed/);
  assert.deepEqual(calls.splice(0), [`/Run /TN ${TASK_NAME}`], "installing again rewrites nothing and leaves a running host running: the task takes one instance");

  await installTask("D:\\storytree", scheduler);
  assert.match(readFileSync(script, "utf8"), /^cd \/d "D:\\storytree"$/m);
  assert.deepEqual(calls.splice(0), ["stop host", `/Create /TN ${TASK_NAME} /XML ${xml} /F`, `/Run /TN ${TASK_NAME}`], "a changed task stops the host it ran, is registered again, and starts the host on the new text");

  assert.match(await uninstallTask(scheduler), /^Stopped the service host and deleted/);
  assert.equal(existsSync(script), false);
  assert.equal(existsSync(xml), false);
  assert.deepEqual(calls.splice(0), ["stop host", `/Delete /TN ${TASK_NAME} /F`]);
  assert.match(await uninstallTask(scheduler), /^No scheduled task storytree-host is installed/);
  assert.deepEqual(calls, [], "with none installed, uninstall touches nothing");

  const home = path.join(dir, "home");
  assert.equal(takeStop(home), false, "no stop was asked for");
  requestStop(home);
  assert.equal(takeStop(home), true, "the running host takes a stop asked for");
  assert.equal(takeStop(home), false, "once");

  const said: string[] = [];
  let living = true;
  const stopper = (pid: number | undefined, stopsWhenAsked: boolean) => ({
    pid: () => pid,
    alive: () => living,
    requestStop: () => { said.push("asked"); if (stopsWhenAsked) living = false; },
    wait: async () => {},
    end: (ended: number) => { said.push(`ended ${ended}`); living = false; },
    waitMs: 2,
    pollMs: 1,
  });
  assert.equal(await stopRunningHost(stopper(undefined, true)), "none", "no host has run here");
  assert.equal(await stopRunningHost(stopper(41, true)), "stopped");
  assert.deepEqual(said.splice(0), ["asked"], "a host that stops when asked is never ended");
  living = true;
  assert.equal(await stopRunningHost(stopper(42, false)), "ended");
  assert.deepEqual(said.splice(0), ["asked", "ended 42"], "a host still running after the wait is ended");
  assert.equal(await stopRunningHost(stopper(43, false)), "none", "a host no longer running is left alone");
});
