/**
 * A dev build's commands, connected to a throwaway home: what a live Codex or Claude Code check runs
 * against on any box, instead of a rig hand-built for it. Its own HOME, CODEX_HOME, CLAUDE_CONFIG_DIR
 * and storytree home, its own Postgres (started on demand, as the app would start), and the same
 * connection an installed storytree makes. The user's own homes are only read, for Codex's sign-in, which
 * goes back to the user's when Codex refreshed it inside (a refresh ends the sign-in it replaced). Claude
 * Code's sign-in is never copied, for the same reason: start it with CLAUDE_CODE_OAUTH_TOKEN set (a
 * long-lived token from `claude setup-token`).
 *
 *   pnpm --filter @storytree/app-setup dev-home <dir> --codex [--claude]
 *   . <dir>/env.sh            (PowerShell: . <dir>/env.ps1), then codex or claude in a new folder
 *   pnpm --filter @storytree/app-setup dev-home <dir> --remove
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { buildBins } from "@storytree/agent-link/bins";
import { findBinaries } from "@storytree/local-postgres";
import { installCommand } from "../deliver/command.js";
import { connectAgents, installedToolServerCommand, type ConnectionResult, type Harness, type RunHarness } from "./index.js";

const MARK = "storytree-dev-home.json";

export interface DevHomeOptions {
  readonly dir: string;
  readonly harnesses: readonly Harness[];
  /** Where Codex's sign-in is read from (and handed back to). By default the user's own ~/.codex. */
  readonly signedIn?: { readonly codex?: string };
  /** Builds the dev build's commands into a folder. By default the agent link's own build. */
  readonly build?: (outdir: string) => Promise<Record<string, string>>;
  readonly run?: RunHarness;
}

export interface DevHome {
  readonly results: readonly ConnectionResult[];
  /** The environment a session in the throwaway home runs with. */
  readonly env: Record<string, string>;
  /** env.sh (env.ps1 on Windows): source it, then start the agent. */
  readonly envFile: string;
}

/** Make (or remake) the throwaway home in `dir` and connect the chosen agents there. */
export async function makeDevHome(options: DevHomeOptions): Promise<DevHome> {
  const dir = path.resolve(options.dir);
  await removeDevHome(dir);
  const tools = path.join(dir, "tools");
  const home = path.join(dir, "home");
  const codex = path.join(home, ".codex");
  const claude = path.join(home, ".claude");
  const storytree = path.join(home, ".storytree", "0.3");
  for (const folder of [codex, claude, storytree]) mkdirSync(folder, { recursive: true });
  const userAuth = path.join(options.signedIn?.codex ?? path.join(homedir(), ".codex"), "auth.json");
  const copied = options.harnesses.includes("codex") && existsSync(userAuth) ? readFileSync(userAuth, "utf8") : undefined;
  if (copied !== undefined) writeFileSync(path.join(codex, "auth.json"), copied, { mode: 0o600 });
  writeFileSync(path.join(dir, MARK), `${JSON.stringify({ made: new Date().toISOString(), ...(copied === undefined ? {} : { codexSignIn: { from: userAuth, copied } }) })}\n`);

  const bins = await (options.build ?? buildBins)(tools);

  // Its own database: a storytree command that finds it closed opens it from this record, as it opens the app.
  const database = fileURLToPath(new URL("./dev-database.ts", import.meta.url));
  writeFileSync(path.join(storytree, "app.json"), `${JSON.stringify({ command: process.execPath, args: ["--import", import.meta.resolve("tsx"), database, storytree] })}\n`);

  const node = process.execPath;
  const launcher = installCommand({ home: storytree, searchPath: "", tools: { dir: tools, app: node, node, mcp: bins["storytree-mcp"]!, hook: bins["storytree-hook"]!, setup: bins["storytree-setup"]!, cli: bins.storytree!, deliver: "" } });
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codex,
    CLAUDE_CONFIG_DIR: claude,
    STORYTREE_HOME: storytree,
    PATH: [launcher.pathEntry, process.env.PATH ?? ""].join(path.delimiter),
  };
  const results = await connectAgents({ harnesses: options.harnesses, installed: installedToolServerCommand(node, bins["storytree-mcp"]!), home, env: { ...process.env, ...env }, ...(options.run === undefined ? {} : { run: options.run }) });

  const windows = process.platform === "win32";
  const envFile = path.join(dir, windows ? "env.ps1" : "env.sh");
  writeFileSync(envFile, Object.entries(env).map(([name, value]) => windows ? `$env:${name} = '${value.replaceAll("'", "''")}'` : `export ${name}='${value.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  return { results, env, envFile };
}

/**
 * Stop the throwaway home's database, if it runs, hand back a Codex sign-in refreshed inside it, and delete
 * the home. Refuses a folder this did not make.
 */
export async function removeDevHome(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  if (!existsSync(path.join(dir, MARK))) throw new Error(`${dir} exists and is not a dev home made by this command: choose a new folder.`);
  const { codexSignIn } = JSON.parse(readFileSync(path.join(dir, MARK), "utf8")) as { codexSignIn?: { from: string; copied: string } };
  const inside = path.join(dir, "home", ".codex", "auth.json");
  if (codexSignIn !== undefined && existsSync(inside)) {
    const now = readFileSync(inside, "utf8");
    const users = existsSync(codexSignIn.from) ? readFileSync(codexSignIn.from, "utf8") : undefined;
    if (now !== codexSignIn.copied) {
      // Refreshed inside, so the user's copy is spent. Theirs changed too only if they signed in again meanwhile: keep theirs.
      if (users === codexSignIn.copied) writeFileSync(codexSignIn.from, now, { mode: 0o600 });
      else throw new Error(`Codex refreshed its sign-in inside ${dir}, and ${codexSignIn.from} changed meanwhile: check that codex login status works, then remove ${dir} by hand.`);
    }
  }
  const dataDir = path.join(dir, "home", ".storytree", "0.3", "pgdata");
  const owner = `${dataDir}.owner.json`;
  const record = existsSync(owner) ? readFileSync(owner, "utf8") : undefined;
  const postmaster = path.join(dataDir, "postmaster.pid");
  const postgresPid = existsSync(postmaster) ? Number(readFileSync(postmaster, "utf8").split("\n")[0]) : undefined;
  if (record !== undefined) {
    const { pid } = JSON.parse(record) as { pid: number };
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid database owner ${pid}; keeping ${dir}.`);
    try { process.kill(pid, "SIGTERM"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    // Windows kill terminates Node without running its cleanup handler. Wait for the process,
    // not its owner file: that file remains when the handler never ran (also after a crash).
    await waitForExit(pid, dir);
  }
  if (existsSync(path.join(dataDir, "PG_VERSION"))) {
    const pgCtl = (...args: string[]) => new Promise<number | null>((resolve, reject) => {
      const child = spawn(path.join(findBinaries(), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl"), ["-D", dataDir, ...args], { stdio: "ignore", windowsHide: true, timeout: 25_000 });
      child.on("error", reject);
      child.on("close", resolve);
    });
    let status = await pgCtl("status");
    if (status === 0) {
      await pgCtl("-m", "fast", "-w", "-t", "20", "stop");
      status = await pgCtl("status");
    }
    if (status !== 3) throw new Error(`Could not confirm the database stopped; keeping ${dir}.`);
  }
  // pg_ctl can observe postmaster.pid disappearing just before the OS process has exited.
  if (postgresPid !== undefined) await waitForExit(postgresPid, dir);
  if (existsSync(owner)) {
    if (readFileSync(owner, "utf8") !== record) throw new Error(`The database owner changed; keeping ${dir}.`);
    rmSync(owner);
  }
  rmSync(dir, { recursive: true, force: true });
}

async function waitForExit(pid: number, dir: string): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid database process ${pid}; keeping ${dir}.`);
  for (let waited = 0; processAlive(pid) && waited < 20_000; waited += 250) await sleep(250);
  if (processAlive(pid)) throw new Error(`The database process ${pid} has not stopped; keeping ${dir}.`);
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, ...flags] = process.argv.slice(2);
  const harnesses = [...(flags.includes("--codex") ? ["codex" as const] : []), ...(flags.includes("--claude") ? ["claude-code" as const] : [])];
  const known = ["--codex", "--claude", "--remove"];
  if (dir === undefined || dir.startsWith("--") || flags.some((flag) => !known.includes(flag)) || (flags.includes("--remove") ? flags.length !== 1 : harnesses.length === 0)) {
    console.error("usage: dev-home <dir> --codex [--claude] | dev-home <dir> --remove");
    process.exit(2);
  }
  if (flags.includes("--remove")) {
    await removeDevHome(path.resolve(dir));
    console.log(`Removed ${path.resolve(dir)}.`);
  } else {
    const made = await makeDevHome({ dir, harnesses });
    for (const result of made.results) console.log(`${result.harness}: tools ${result.tools}; hooks ${result.hooks}.\n${result.next}\n`);
    if (harnesses.includes("claude-code") && process.env.CLAUDE_CODE_OAUTH_TOKEN === undefined) console.log("Claude Code: its sign-in is not copied (a copy refreshes on its own and ends yours). Export CLAUDE_CODE_OAUTH_TOKEN (from claude setup-token) before starting it.\n");
    console.log(`Source ${made.envFile}, then start the agent in a new folder. Its database starts when a storytree command first needs it; remove it all with: dev-home ${dir} --remove`);
    if (made.results.some((result) => result.tools === "not connected")) process.exitCode = 1;
  }
}
