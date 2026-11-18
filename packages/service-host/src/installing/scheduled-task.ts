// Capability 3 · Keeping the host running
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TASK_NAME = "storytree-host";

export const STOP_WAIT_MS = 45_000;

export interface HostScript {
  readonly checkout: string;
  readonly node: string;
  readonly log: string;
  readonly restartSeconds?: number;
}

export function hostScript({ checkout, node, log, restartSeconds = 10 }: HostScript): string {
  return [
    "@echo off",
    "rem storytree's service host (ADR-1180 D5): runs every service this machine's settings turn on. Written by `storytree services install`;",
    "rem `storytree services uninstall` removes it. A clean stop (exit 0) ends it; any other end starts the host again.",
    `cd /d "${checkout}"`,
    ":run",
    `set "NODE=node"`,
    `where node >nul 2>nul || set "NODE=${node}"`,
    `call "%NODE%" --import tsx packages\\cli\\src\\bins\\storytree.ts services run >> "${log}" 2>&1`,
    "if %ERRORLEVEL%==0 exit /b 0",
    `echo service host ended with %ERRORLEVEL%; starting it again in ${restartSeconds} seconds>> "${log}"`,
    `ping -n ${restartSeconds + 1} 127.0.0.1 >nul`,
    "goto run",
    "",
  ].join("\r\n");
}

const xmlEscaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

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

export interface TaskScheduler {
  readonly dir: string;
  readonly user: string;
  readonly node: string;
  readonly schtasks: (args: readonly string[]) => void;
  readonly stopHost: () => Promise<void>;
}

const files = (dir: string) => ({ script: path.join(dir, "storytree-host.cmd"), xml: path.join(dir, "storytree-host.xml"), log: path.join(dir, "host.log") });

const readOrNone = (file: string, encoding: BufferEncoding) => (existsSync(file) ? readFileSync(file, encoding) : undefined);

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

export async function uninstallTask({ dir, schtasks, stopHost }: TaskScheduler): Promise<string> {
  const { script, xml } = files(dir);
  if (!existsSync(xml)) return `No scheduled task ${TASK_NAME} is installed (${xml}).`;
  await stopHost();
  schtasks(["/Delete", "/TN", TASK_NAME, "/F"]);
  rmSync(script, { force: true });
  rmSync(xml);
  return `Stopped the service host and deleted the scheduled task ${TASK_NAME}: no service host runs here until it is installed again.`;
}

export interface HostStopper {
  readonly pid: () => number | undefined;
  readonly alive: (pid: number) => boolean;
  readonly requestStop: () => void;
  readonly wait: (ms: number) => Promise<void>;
  readonly end: (pid: number) => void;
  readonly waitMs?: number;
  readonly pollMs?: number;
}

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

export function userTaskScheduler(dir: string, stopper: HostStopper, env: NodeJS.ProcessEnv = process.env): TaskScheduler {
  return {
    dir,
    user: env.USERDOMAIN ? `${env.USERDOMAIN}\\${env.USERNAME}` : `${env.USERNAME}`,
    node: process.execPath,
    schtasks: (args) => { execFileSync("schtasks.exe", [...args], { stdio: ["ignore", "pipe", "pipe"] }); },
    stopHost: async () => { await stopRunningHost(stopper); },
  };
}

export function endTree(pid: number): void {
  execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: ["ignore", "pipe", "pipe"] });
}
