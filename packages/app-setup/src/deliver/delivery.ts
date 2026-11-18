// Capability 1 · Get storytree
import { locateApp, locateStorytree, readLibrary, storytreeHome } from "@storytree/project-and-caller";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { installCommand } from "./command.js";
import { runInstalledConnection } from "../connect/installed.js";
import { clearOlderTools, runningFrom, stageTools, verifyPayload, type Architecture, type InstalledTools } from "./payload.js";
import { agentFiles, agentLabel, installedToolServerCommand, reconnectAgents, type ConnectionOptions } from "../connect/index.js";
import { openUninstaller, uninstall, uninstallAsks, uninstallReportFile } from "./uninstall.js";

interface DeliveryOptions {
  installDir: string;
  home: string;
  arch: Architecture;
  searchPath: string;
  platform?: NodeJS.Platform;
}

export interface Launched {
  log: string;
  toolLog: string;
  toolLogFrom: number;
  exit(): { code: number | null; signal: NodeJS.Signals | null } | undefined;
}

function sizeOf(file: string): number {
  try { return statSync(file).size; } catch { return 0; }
}

function readFrom(file: string, from: number): string {
  try { return readFileSync(file).subarray(from).toString("utf8"); } catch { return ""; }
}

export function launch(exe: string, home: string, args: string[] = []): Promise<Launched> {
  mkdirSync(home, { recursive: true });
  const log = path.join(home, "app-launch.log");
  const toolLog = path.join(home, "pgdata.tools.log");
  const toolLogFrom = sizeOf(toolLog);
  const out = openSync(log, "w");
  return new Promise((resolve, reject) => {
    let ended: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: ["ignore", out, out] });
    closeSync(out);
    child.once("error", reject);
    child.once("exit", (code, signal) => { ended = { code, signal }; });
    child.once("spawn", () => { child.unref(); resolve({ log, toolLog, toolLogFrom, exit: () => ended }); });
  });
}

const CAUSES: { pattern: RegExp; source: "app" | "database"; cause: string }[] = [
  { pattern: /running as root without --no-sandbox/i, source: "app", cause: "the app refuses to run as root (Electron's sandbox needs an ordinary user). Run the installer as an ordinary user, not as root or with sudo" },
  { pattern: /fuse: |\/dev\/fuse|libfuse/i, source: "app", cause: "the AppImage could not use /dev/fuse (FUSE is missing or not permitted here, as in many containers). Run the installer again with APPIMAGE_EXTRACT_AND_RUN=1 set, so the app runs without FUSE" },
  { pattern: /missing x server or \$display|cannot open display|platform failed to initialize/i, source: "app", cause: "there is no display to open the app's window on. Run the installer from a desktop session (with DISPLAY or WAYLAND_DISPLAY set)" },
  { pattern: /cannot be run as root/i, source: "database", cause: "its database refuses to run as root. Run the installer as an ordinary user, not as root or with sudo" },
];

function lastLines(text: string, count = 5): string {
  return text.trim().split(/\r?\n/).slice(-count).join("\n");
}

function failed(ended: ReturnType<Launched["exit"]>): boolean {
  return ended !== undefined && (ended.code !== 0 || ended.signal !== null);
}

export function whyAppDidNotStart(launched: Launched, waited: string): string {
  const output = readFrom(launched.log, 0);
  const database = readFrom(launched.toolLog, launched.toolLogFrom);
  const ended = launched.exit();
  const how = failed(ended) ? `stopped (${ended!.signal ?? `exit code ${ended!.code}`}) before its database was ready` : `did not come up within ${waited}`;
  const found = CAUSES.find((c) => c.pattern.test(c.source === "app" ? output : database));
  if (found) return `The app ${how}: ${found.cause}. Its output is in ${found.source === "app" ? launched.log : launched.toolLog}.`;
  const tail = lastLines(output) || lastLines(database);
  const said = tail ? ` Its last output:\n${tail}\n` : " It printed nothing. ";
  return `The app ${how}.${said}Its output is in ${launched.log}${database ? ` and its database's in ${launched.toolLog}` : ""}.`;
}

export async function waitForApp(home: string, timeoutMs = 90_000, launched?: Launched): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const remote = readLibrary(home).location !== "local";
  const waited = `${timeoutMs / 1000} seconds`;
  while (Date.now() < deadline) {
    if (launched && failed(launched.exit())) throw new Error(whyAppDidNotStart(launched, waited));
    if (remote) {
      if (locateApp(home).running) return;
      await sleep(250);
      continue;
    }
    const address = locateStorytree({ dataDir: path.join(home, "pgdata") });
    if (address.running) {
      const { hostname, port } = new URL(address.url);
      const accepts = await new Promise<boolean>((resolve) => {
        const socket = connect({ host: hostname, port: Number(port), timeout: 500 });
        const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
      });
      if (accepts) return;
    }
    await sleep(250);
  }
  if (launched) throw new Error(whyAppDidNotStart(launched, waited));
  throw new Error(`The app did not come up within ${waited}. Open the app to read its error, then retry the delivery command.`);
}

export async function finishDelivery(options: DeliveryOptions, effects: {
  launch(exe: string, home: string): Promise<Launched | void>;
  waitForApp(home: string, timeoutMs?: number, launched?: Launched): Promise<void>;
} = { launch, waitForApp }) {
  const installed = verifyPayload(options.installDir, options.arch, options.platform);
  const launched = await effects.launch(installed.app, options.home);
  await effects.waitForApp(options.home, undefined, launched || undefined);
  const tools = stageTools(options.installDir, options.home, options.arch, options.platform ?? process.platform);
  const command = installCommand({ ...options, tools });
  writeRecord(options, tools);
  return { state: "ready", tools, command };
}

function writeRecord(options: DeliveryOptions, tools: InstalledTools, pending: readonly string[] = []): void {
  const record = { schema: 1, installDir: path.resolve(options.installDir), tools, ...(pending.length > 0 ? { pending } : {}) };
  mkdirSync(options.home, { recursive: true });
  const temp = path.join(options.home, `delivery-${process.pid}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2) + "\n");
    renameSync(temp, path.join(options.home, "delivery.json"));
  } finally { rmSync(temp, { force: true }); }
}

export interface FollowedTools {
  readonly moved: readonly string[];
  readonly notMoved: readonly { readonly agent: string; readonly reason: string }[];
}

export async function followBuildTools(options: DeliveryOptions & {
  connections?: Pick<ConnectionOptions, "home" | "env" | "run">;
  remove?: (file: string) => void;
  running?: (dir: string) => boolean;
}): Promise<FollowedTools | undefined> {
  let recorded: { installDir?: unknown; tools?: { dir?: unknown }; pending?: unknown } | undefined;
  try { recorded = JSON.parse(readFileSync(path.join(options.home, "delivery.json"), "utf8")); } catch { return undefined; }
  if (typeof recorded?.installDir !== "string" || path.resolve(recorded.installDir).toLowerCase() !== path.resolve(options.installDir).toLowerCase()) return undefined;
  const tools = stageTools(options.installDir, options.home, options.arch, options.platform ?? process.platform);
  const pending = Array.isArray(recorded.pending) && recorded.pending.length > 0;
  let followed: FollowedTools | undefined;
  if (recorded.tools?.dir !== tools.dir || pending) {
    installCommand({ ...options, tools });
    const results = await reconnectAgents({ installed: installedToolServerCommand(tools.node, tools.mcp), ...options.connections });
    const failed = results.filter((result) => result.tools === "not connected");
    followed = {
      moved: results.filter((result) => result.tools !== "not connected").map((result) => agentLabel(result.harness)),
      notMoved: failed.map((result) => ({ agent: agentLabel(result.harness), reason: result.next })),
    };
    writeRecord(options, tools, failed.map((result) => result.harness));
  }
  const named = agentFiles(options.connections ?? {}).map((file) => { try { return readFileSync(file, "utf8"); } catch { return ""; } }).join("\n");
  const running = options.running ?? ((options.platform ?? process.platform) === "win32" ? undefined : runningFrom());
  clearOlderTools(options.home, tools.dir, options.remove, (name) => named.includes(name), running);
  return followed;
}

export function runtimeProblem(arch: Architecture, runtime = { platform: process.platform, arch: process.arch, node: process.versions.node }): string | undefined {
  if (runtime.platform === "darwin" && arch !== "arm64") return "storytree needs a Mac with Apple Silicon";
  if (runtime.platform === "linux" && arch !== "x64") return "storytree on Linux needs an x64 computer";
  if (!["win32", "darwin", "linux"].includes(runtime.platform) || runtime.arch !== arch || runtime.node.split(".")[0] !== "24") {
    return "The bundled Node runtime does not match this installation";
  }
  return undefined;
}

export async function runDeliveryCommand(args = process.argv.slice(2)): Promise<void> {
  if (args[0] === "connect" || args[0] === "disconnect") {
    process.stdout.write(await runInstalledConnection(args[0], args.slice(1)) + "\n");
    return;
  }
  if (args[0] === "uninstall-asks" && args.length === 2) {
    const asks = uninstallAsks(args[1]!, storytreeHome());
    process.stdout.write(asks + "\n");
    process.exitCode = asks === "ask" ? 0 : asks === "no library" ? 10 : 11;
    return;
  }
  if (args[0] === "uninstall" && args.length === 3 && (args[2] === "keep" || args[2] === "remove")) {
    const report = await uninstall({ installDir: args[1]!, home: storytreeHome(), library: args[2], reportFile: uninstallReportFile() });
    process.stdout.write(report.lines.join("\n") + "\n");
    if (!report.complete) process.exitCode = 1;
    return;
  }
  if (args[0] === "open-uninstaller" && args.length <= 2) {
    process.stdout.write(await openUninstaller(args[1]) + "\n");
    return;
  }
  const [action, installDir, arch] = args;
  if (!installDir || (arch !== "x64" && arch !== "arm64") || (action !== "inspect" && action !== "finish")) throw new Error("usage: storytree-deliver inspect|finish <installation directory> x64|arm64");
  const problem = runtimeProblem(arch);
  if (problem) throw new Error(problem);
  const tools = verifyPayload(installDir, arch);
  const result = action === "inspect" ? { state: "usable", tools } : await finishDelivery({ installDir, arch, home: storytreeHome(), searchPath: process.env.PATH ?? "" });
  process.stdout.write(JSON.stringify(result) + "\n");
}
