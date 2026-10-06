/** Capability 1 · Get storytree. */
import { locateApp, locateStorytree, readLibrary, storytreeHome } from "@storytree/agent-link";
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { installCommand } from "./command.js";
import { runInstalledConnection } from "../connect/installed.js";
import { addProject, projectFolder } from "../project/index.js";
import { verifyPayload, type Architecture } from "./payload.js";
import { openUninstaller, uninstall, uninstallAsks } from "./uninstall.js";

interface DeliveryOptions {
  installDir: string;
  home: string;
  arch: Architecture;
  searchPath: string;
  platform?: NodeJS.Platform;
}

/** Launch even when already running: Electron's second-instance handler brings its window back. */
function launch(exe: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/**
 * Wait until the delivered app is up. On a local library that is its database answering; on a
 * Cloud SQL or Postgres-address library the app starts no local database, so it is the app itself running (its launch
 * record's process, app lifecycle 1.11).
 */
export async function waitForApp(home: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const cloud = readLibrary(home).location !== "local";
  while (Date.now() < deadline) {
    if (cloud) {
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
  throw new Error(`The app did not come up within ${timeoutMs / 1000} seconds. Open the app to read its error, then retry the delivery command.`);
}

/** Finishing touches only delivery's own command and record. It never creates a project or configures a harness. */
export async function finishDelivery(options: DeliveryOptions, effects = { launch, waitForApp }) {
  const tools = verifyPayload(options.installDir, options.arch, options.platform);
  await effects.launch(tools.app);
  await effects.waitForApp(options.home);
  const command = installCommand({ ...options, tools });
  const record = { schema: 1, installDir: path.resolve(options.installDir), tools };
  mkdirSync(options.home, { recursive: true });
  const temp = path.join(options.home, `delivery-${process.pid}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2) + "\n");
    renameSync(temp, path.join(options.home, "delivery.json"));
  } finally { rmSync(temp, { force: true }); }
  return { state: "ready", tools, command };
}

/** Installed delivery and connection commands. inspect has no side effects, including no app launch. */
export async function runDeliveryCommand(args = process.argv.slice(2)): Promise<void> {
  if (args[0] === "connect" || args[0] === "disconnect") {
    process.stdout.write(await runInstalledConnection(args[0], args.slice(1)) + "\n");
    return;
  }
  // The installer's project folder step (ADR-0752 D1): what the folder is, then setting it up on the user's choice.
  if (args[0] === "project" && args.length === 2) {
    process.stdout.write(JSON.stringify(await projectFolder(args[1]!)) + "\n");
    return;
  }
  if (args[0] === "add-project" && args.length === 3) {
    process.stdout.write(JSON.stringify(await addProject(args[1]!, args[2]!)) + "\n");
    return;
  }
  // Leaving storytree: the NSIS uninstaller asks, then removes, from this installation's own Node.
  if (args[0] === "uninstall-asks" && args.length === 2) {
    const asks = uninstallAsks(args[1]!, storytreeHome());
    process.stdout.write(asks + "\n");
    process.exitCode = asks === "ask" ? 0 : asks === "no library" ? 10 : 11;
    return;
  }
  if (args[0] === "uninstall" && args.length === 3 && (args[2] === "keep" || args[2] === "remove")) {
    const report = await uninstall({ installDir: args[1]!, home: storytreeHome(), library: args[2] });
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
  if (process.platform !== "win32" || process.arch !== arch || process.versions.node.split(".")[0] !== "24") throw new Error("The bundled Node runtime does not match this Windows installation");
  const tools = verifyPayload(installDir, arch);
  const result = action === "inspect" ? { state: "usable", tools } : await finishDelivery({ installDir, arch, home: storytreeHome(), searchPath: process.env.PATH ?? "" });
  process.stdout.write(JSON.stringify(result) + "\n");
}
