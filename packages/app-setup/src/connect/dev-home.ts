// Capability 2 · Connect an agent
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { buildBins } from "../bins/build.js";
import { pgCtl } from "@storytree/local-postgres";
import { probeProcess, type ProcessIdentity } from "@storytree/session-management/processes";
import { installCommand } from "../deliver/command.js";
import { connectAgents, installedToolServerCommand, type ConnectionResult, type Harness, type RunHarness } from "./index.js";

const MARK = "storytree-dev-home.json";
const signInDigest = (contents: string): string => createHash("sha256").update(contents).digest("hex");

interface DevHomeMarker {
  made: string;
  codexSignIn?: { from: string } & ({ copiedSha256: string } | { copied: string });
}

export interface DevHomeOptions {
  readonly dir: string;
  readonly harnesses: readonly Harness[];
  readonly signedIn?: { readonly codex?: string };
  readonly build?: (outdir: string) => Promise<Record<string, string>>;
  readonly run?: RunHarness;
}

export interface DevHome {
  readonly results: readonly ConnectionResult[];
  readonly env: Record<string, string>;
  readonly envFile: string;
}

export async function makeDevHome(options: DevHomeOptions): Promise<DevHome> {
  const dir = path.resolve(options.dir);
  await removeDevHome(dir);
  const tools = path.join(dir, "tools");
  const home = path.join(dir, "home");
  const codex = path.join(home, ".codex");
  const claude = path.join(home, ".claude");
  const storytree = path.join(home, ".storytree", "0.3");
  if (process.platform === "win32") windowsPermissions([{ file: dir, kind: "create" }]);
  for (const folder of [codex, claude, storytree]) mkdirSync(folder, { recursive: true, mode: 0o700 });
  const userAuth = path.join(options.signedIn?.codex ?? path.join(homedir(), ".codex"), "auth.json");
  const copied = options.harnesses.includes("codex") && existsSync(userAuth) ? readFileSync(userAuth, "utf8") : undefined;
  if (copied !== undefined) writeFileSync(path.join(codex, "auth.json"), copied, { mode: 0o600 });
  writeFileSync(path.join(dir, MARK), `${JSON.stringify({ made: new Date().toISOString(), ...(copied === undefined ? {} : { codexSignIn: { from: userAuth, copiedSha256: signInDigest(copied) } }) })}\n`, { mode: 0o600 });

  const bins = await (options.build ?? buildBins)(tools);

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

export async function removeDevHome(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  if (!existsSync(path.join(dir, MARK))) throw new Error(`${dir} exists and is not a dev home made by this command: choose a new folder.`);
  const markerFile = path.join(dir, MARK);
  const inside = path.join(dir, "home", ".codex", "auth.json");
  if (process.platform === "win32") {
    windowsPermissions([
      ...[dir, path.join(dir, "home"), path.dirname(inside)].filter(existsSync).map(file => ({ file, kind: "directory" as const })),
      ...[markerFile, inside].filter(existsSync).map(file => ({ file, kind: "file" as const })),
    ]);
  } else {
    chmodSync(dir, 0o700);
    chmodSync(markerFile, 0o600);
  }
  const marker = JSON.parse(readFileSync(markerFile, "utf8")) as DevHomeMarker;
  let codexSignIn = marker.codexSignIn;
  if (codexSignIn !== undefined && "copied" in codexSignIn) {
    codexSignIn = { from: codexSignIn.from, copiedSha256: signInDigest(codexSignIn.copied) };
    marker.codexSignIn = codexSignIn;
    writeFileSync(markerFile, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
  }
  if (codexSignIn !== undefined && existsSync(inside)) {
    const now = readFileSync(inside, "utf8");
    const users = existsSync(codexSignIn.from) ? readFileSync(codexSignIn.from, "utf8") : undefined;
    if (signInDigest(now) !== codexSignIn.copiedSha256) {
      if (users !== undefined && signInDigest(users) === codexSignIn.copiedSha256) {
        if (process.platform === "win32") windowsPermissions([{ file: codexSignIn.from, kind: "file" }]);
        else chmodSync(codexSignIn.from, 0o600);
        writeFileSync(codexSignIn.from, now, { mode: 0o600 });
      }
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
    const identityFile = path.join(dir, "home", ".storytree", "0.3", "dev-database.json");
    const identity = existsSync(identityFile) ? JSON.parse(readFileSync(identityFile, "utf8")) as ProcessIdentity : undefined;
    const reading = identity?.pid === pid ? await probeProcess(identity) : undefined;
    if (identity !== undefined && reading?.state === "live") {
      try { process.kill(pid, "SIGTERM"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      for (let waited = 0; (await probeProcess(identity)).state === "live" && waited < 20_000; waited += 250) await sleep(250);
      if ((await probeProcess(identity)).state === "live") throw new Error(`The database process ${pid} has not stopped; keeping ${dir}.`);
    } else if (reading?.state !== "gone" && processAlive(pid)) {
      throw new Error(`Could not confirm the database owner ${pid} is this home's; keeping ${dir}.`);
    }
  }
  if (existsSync(path.join(dataDir, "PG_VERSION"))) {
    const run = (...args: string[]) => pgCtl(dataDir, args, { timeoutMs: 25_000 });
    let status = await run("status");
    if (status === 0) {
      await run("-m", "fast", "-w", "-t", "20", "stop");
      status = await run("status");
    }
    if (status !== 3) throw new Error(`Could not confirm the database stopped; keeping ${dir}.`);
  }
  if (postgresPid !== undefined) await waitForExit(postgresPid, dir);
  if (existsSync(owner)) {
    if (readFileSync(owner, "utf8") !== record) throw new Error(`The database owner changed; keeping ${dir}.`);
    rmSync(owner);
  }
  rmSync(dir, { recursive: true, force: true });
}

function windowsPermissions(entries: { file: string; kind: "create" | "directory" | "file" }[]): void {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$entries = ConvertFrom-Json ([Console]::In.ReadToEnd())
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($entry in $entries) {
  $directory = $entry.kind -ne 'file'
  $acl = if ($directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $acl.SetOwner($owner)
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = if ($directory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner, 'FullControl', $inherit, 'None', 'Allow'))
  if ($entry.kind -eq 'create') { [void][IO.Directory]::CreateDirectory($entry.file, $acl) }
  elseif ($directory) { [IO.Directory]::SetAccessControl($entry.file, $acl) }
  else { [IO.File]::SetAccessControl($entry.file, $acl) }
}`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { input: JSON.stringify(entries), env, windowsHide: true, timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
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
