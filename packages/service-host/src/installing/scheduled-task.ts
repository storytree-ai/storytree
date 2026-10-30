/**
 * Capability 3 · Keeping the host running, contracts 3.3 and 3.4 (ADR-1180 D5). On Windows the one entry point that keeps
 * the service host running is a scheduled task storytree writes, storytree-host, started at this user's logon, so the
 * host does not depend on the desktop app being open. Its action runs a script, kept in the storytree home beside the
 * host's status, that runs node itself on `storytree services run` in storytree's checkout and starts it again 10 seconds
 * after any end but a clean one (exit 0): Task Scheduler restarts a task only when it fails to start, so the loop is what
 * Restart=always is on Linux. A stop is asked for before it is forced: the host takes a stop request, stops its own
 * services (each child hears that on its IPC channel, where a Windows SIGTERM would end it unheard) and exits 0, which
 * also ends the loop; only a host still running after the wait is ended with its process tree.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The task's name in Task Scheduler. */
export const TASK_NAME = "storytree-host";

/** How long a stop request is waited on before the host is ended, as the Linux unit's TimeoutStopSec. */
export const STOP_WAIT_MS = 45_000;

/** What the script needs: the checkout it runs, the node it falls back on, the log its lines go to, and its wait between runs. */
export interface HostScript {
  readonly checkout: string;
  /** The node that runs when none is on PATH: the one that installed the task. */
  readonly node: string;
  readonly log: string;
  readonly restartSeconds?: number;
}

/** The cmd script the task runs: the host as node itself, started again after any end but exit 0. */
export function hostScript({ checkout, node, log, restartSeconds = 10 }: HostScript): string {
  return [
    "@echo off",
    "rem storytree's service host (ADR-1180 D5): runs every service this machine's settings turn on. Written by `storytree services install`;",
    "rem `storytree services uninstall` removes it. A clean stop (exit 0) ends it; any other end starts the host again.",
    `cd /d "${checkout}"`,
    ":run",
    `set "NODE=node"`,
    `where node >nul 2>nul || set "NODE=${node}"`,
    // `call`, so a node that is itself a .cmd shim returns to the loop rather than ending the script.
    `call "%NODE%" --import tsx packages\\cli\\src\\bins\\storytree.ts services run >> "${log}" 2>&1`,
    "if %ERRORLEVEL%==0 exit /b 0",
    `echo service host ended with %ERRORLEVEL%; starting it again in ${restartSeconds} seconds>> "${log}"`,
    `ping -n ${restartSeconds + 1} 127.0.0.1 >nul`,
    "goto run",
    "",
  ].join("\r\n");
}

const xmlEscaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The task that runs `script` at `user`'s logon, windowless, with no time limit, on battery too, one instance at a time. */
export function hostTask(script: string, user: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    "  <RegistrationInfo>",
    "    <Description>storytree's service host (ADR-1180 D5), written by `storytree services install`; `storytree services uninstall` removes it.</Description>",
    "  </RegistrationInfo>",
    "  <Triggers>",
    `    <LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscaped(user)}</UserId></LogonTrigger>`,
    "  </Triggers>",
    "  <Principals>",
    `    <Principal id="Author"><UserId>${xmlEscaped(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>`,
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd></IdleSettings>",
    "  </Settings>",
    `  <Actions Context="Author">`,
    `    <Exec><Command>conhost.exe</Command><Arguments>${xmlEscaped(`--headless cmd.exe /d /c "${script}"`)}</Arguments></Exec>`,
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}

/** Where the task's files go, who it runs as, how schtasks is run, and how a running host is stopped. */
export interface TaskScheduler {
  /** The folder the script, the task's XML and the log are kept in: the storytree home's service-host folder. */
  readonly dir: string;
  readonly user: string;
  readonly node: string;
  readonly schtasks: (args: readonly string[]) => void;
  /** Stop the running host, if one runs: ask, wait, and end it only if it is still running. */
  readonly stopHost: () => Promise<void>;
}

const files = (dir: string) => ({ script: path.join(dir, "storytree-host.cmd"), xml: path.join(dir, "storytree-host.xml"), log: path.join(dir, "host.log") });

const readOrNone = (file: string, encoding: BufferEncoding) => (existsSync(file) ? readFileSync(file, encoding) : undefined);

/** Write the script and register the task for `checkout` (unless both already say the same), and have the host running on that text. */
export async function installTask(checkout: string, { dir, user, node, schtasks, stopHost }: TaskScheduler): Promise<string> {
  const { script, xml, log } = files(dir);
  const scriptText = hostScript({ checkout, node, log });
  const taskText = `﻿${hostTask(script, user)}`;
  const same = readOrNone(script, "utf8") === scriptText && readOrNone(xml, "utf16le") === taskText;
  if (!same) {
    mkdirSync(dir, { recursive: true });
    await stopHost();
    writeFileSync(script, scriptText);
    writeFileSync(xml, taskText, "utf16le");
    schtasks(["/Create", "/TN", TASK_NAME, "/XML", xml, "/F"]);
  }
  schtasks(["/Run", "/TN", TASK_NAME]);
  return same
    ? `The scheduled task ${TASK_NAME} was already installed (${script}); it is running.`
    : `Registered the scheduled task ${TASK_NAME}, which runs ${script} at your logon, running the service host from ${checkout}; it is started. Its log: ${log}.`;
}

/** Stop the host, delete the task and remove its files, if it is installed. */
export async function uninstallTask({ dir, schtasks, stopHost }: TaskScheduler): Promise<string> {
  const { script, xml } = files(dir);
  if (!existsSync(xml)) return `No scheduled task ${TASK_NAME} is installed (${xml}).`;
  await stopHost();
  schtasks(["/Delete", "/TN", TASK_NAME, "/F"]);
  rmSync(script, { force: true });
  rmSync(xml);
  return `Stopped the service host and deleted the scheduled task ${TASK_NAME}: no service host runs here until it is installed again.`;
}

/** What stopping a running host stands on: its process, a stop request, a wait, and an end. */
export interface HostStopper {
  readonly pid: () => number | undefined;
  readonly alive: (pid: number) => boolean;
  readonly requestStop: () => void;
  readonly wait: (ms: number) => Promise<void>;
  readonly end: (pid: number) => void;
  readonly waitMs?: number;
  readonly pollMs?: number;
}

/** Ask the running host to stop, wait for it to end, and end its process tree only if it is still running after the wait. */
export async function stopRunningHost({ pid, alive, requestStop, wait, end, waitMs = STOP_WAIT_MS, pollMs = 500 }: HostStopper): Promise<"none" | "stopped" | "ended"> {
  const running = pid();
  if (running === undefined || !alive(running)) return "none";
  requestStop();
  for (let waited = 0; waited < waitMs; waited += pollMs) {
    if (!alive(running)) return "stopped";
    await wait(pollMs);
  }
  if (!alive(running)) return "stopped";
  end(running);
  return "ended";
}

/** This user's Task Scheduler, the task's files in `dir`, the host stopped through `stopper`. */
export function userTaskScheduler(dir: string, stopper: HostStopper, env: NodeJS.ProcessEnv = process.env): TaskScheduler {
  return {
    dir,
    user: env.USERDOMAIN ? `${env.USERDOMAIN}\\${env.USERNAME}` : `${env.USERNAME}`,
    node: process.execPath,
    schtasks: (args) => { execFileSync("schtasks.exe", [...args], { stdio: ["ignore", "pipe", "pipe"] }); },
    stopHost: async () => { await stopRunningHost(stopper); },
  };
}

/** End process `pid` and every process it started. */
export function endTree(pid: number): void {
  execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: ["ignore", "pipe", "pipe"] });
}
