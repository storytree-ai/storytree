/**
 * Capability 1 · Get storytree. Leaving storytree: what the NSIS uninstaller runs, from the installation's own bundled Node, just
 * before it deletes the app's files. It undoes what delivery and connection added: both agents'
 * registration, hooks and status line, the command and its PATH entry, the home, and the updater's
 * download cache. The user's project folders are never touched, not even their storytree marker.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import path from "node:path";
import { installedToolServerCommand, removeConnections, type RunHarness } from "../connect/index.js";
import { toolPaths } from "./payload.js";

export type LibraryChoice = "keep" | "remove";
export interface UserPath {
  /** The per-user PATH exactly as stored, or undefined when there is none. */
  readUserPath(): string | undefined;
  writeUserPath(value: string): void;
}
export interface UninstallOptions {
  readonly installDir: string;
  readonly home: string;
  readonly library: LibraryChoice;
  readonly userHome?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly run?: RunHarness;
  readonly localAppData?: string;
  readonly effects?: UserPath;
}
export interface UninstallReport {
  /** False when something storytree added is still there; `lines` says what and how to remove it. */
  readonly complete: boolean;
  readonly lines: string[];
}

const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * Only the installation that delivery recorded owns the home. An uninstaller of any other copy (a
 * packaging check's, a second install) leaves the home, PATH and update cache alone.
 */
function ownsHome(installDir: string, home: string): boolean {
  try {
    const record = JSON.parse(readFileSync(path.join(home, "delivery.json"), "utf8"));
    return record?.schema === 1 && typeof record.installDir === "string" && same(record.installDir, installDir);
  } catch { return false; }
}

/** What the uninstaller should ask: whether to keep a local library, or nothing. */
export function uninstallAsks(installDir: string, home: string): "ask" | "no library" | "not ours" {
  if (!ownsHome(installDir, home)) return "not ours";
  return existsSync(path.join(home, "pgdata")) ? "ask" : "no library";
}

export function withoutPathEntry(current: string, entry: string): string {
  const wanted = entry.replace(/[\\/]+$/, "").toLowerCase();
  return current.split(";").filter((part) => part.trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "").toLowerCase() !== wanted).join(";");
}

/** The updater's download cache, named in the installation's own update configuration. */
function updaterCache(installDir: string, localAppData: string | undefined): string | undefined {
  try {
    const name = /^updaterCacheDirName:\s*['"]?([^'"\r\n]+)['"]?\s*$/m.exec(readFileSync(path.join(installDir, "resources", "app-update.yml"), "utf8"))?.[1];
    if (name === undefined || localAppData === undefined || name.includes("..") || /[\\/]/.test(name)) return undefined;
    return path.join(localAppData, name);
  } catch { return undefined; }
}

/**
 * The library, and what lets a reinstall find it again: its database and backups, its location
 * setting, this machine's identity (its projects' folders are recorded under it), the chosen project,
 * and hook lines queued for it while storytree was not running. The rest of the home is the app's.
 */
const library = new Set(["pgdata", "pgdata.owner.json", "backups", "settings.json", "machine.json", "project-choice.json", "queued-lines"]);

const remove = (target: string) => rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

export async function uninstall(options: UninstallOptions): Promise<UninstallReport> {
  const lines: string[] = [];
  let complete = true;
  const tools = toolPaths(options.installDir);
  const connections = await removeConnections({
    installed: installedToolServerCommand(tools.node, tools.mcp),
    ...(options.userHome === undefined ? {} : { home: options.userHome }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.run === undefined ? {} : { run: options.run }),
  });
  for (const result of connections) {
    const name = result.harness === "claude-code" ? "Claude Code" : "Codex";
    if (result.tools === "kept") { complete = false; lines.push(`${name}: ${result.next}`); }
    else if (result.tools === "removed") lines.push(`${name}: storytree's connection, hooks and status line removed.`);
  }
  if (!ownsHome(options.installDir, options.home)) return { complete, lines };

  const entry = path.join(options.home, "bin");
  const userPath = options.effects ?? windowsUserPath;
  try {
    const current = userPath.readUserPath();
    if (current !== undefined) {
      const next = withoutPathEntry(current, entry);
      if (next !== current) { userPath.writeUserPath(next); lines.push("The storytree command is off your PATH."); }
    }
  } catch {
    complete = false;
    lines.push(`PATH: remove ${entry} from your user Path environment variable.`);
  }

  const cache = updaterCache(options.installDir, options.localAppData ?? options.env?.LOCALAPPDATA ?? process.env.LOCALAPPDATA);
  if (cache !== undefined && existsSync(cache)) remove(cache);

  try {
    if (options.library === "keep") {
      for (const name of readdirSync(options.home)) if (!library.has(name)) remove(path.join(options.home, name));
      lines.push(`Your library was kept in ${options.home}. Reinstalling storytree picks it up again; delete that folder to remove it.`);
    } else {
      remove(options.home);
      // ~/.storytree may also hold 0.2's files: it goes only when nothing else is in it.
      const parent = path.dirname(options.home);
      if (path.basename(parent) === ".storytree" && existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent);
      lines.push("storytree's home and library were removed.");
    }
  } catch {
    complete = false;
    lines.push(`Some of ${options.home} was in use and stayed; delete it after restarting Windows.`);
  }
  return { complete, lines };
}

/**
 * `storytree setup uninstall`: open this installation's own Windows uninstaller, the one Apps &
 * features runs. With a library choice it runs unattended. The uninstaller stops every process running
 * from the installation, this one included, but only after it has checked for PowerShell (a second or
 * more), by when this command has printed and returned. It is started directly: Windows PowerShell,
 * started detached as a delay, has no console and exits without running anything.
 */
export async function openUninstaller(choice?: string, helperDir = path.dirname(process.argv[1] ?? "")): Promise<string> {
  if (choice !== undefined && choice !== "keep" && choice !== "remove") throw new Error("usage: storytree setup uninstall [--keep-library|--remove-library]");
  const installDir = path.resolve(helperDir, "..", "..");
  const uninstaller = path.join(installDir, "Uninstall storytree-0.3.exe");
  if (process.platform !== "win32" || !existsSync(uninstaller)) {
    throw new Error(`This storytree has no Windows uninstaller at ${uninstaller}; only the installed Windows app has one. Your projects are not affected either way.`);
  }
  // Apps & features runs it with /currentuser, the per-user installation's switch.
  const args = ["/currentuser", ...(choice === undefined ? [] : ["/S", `--${choice}-library`])];
  const child = spawn(uninstaller, args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); }); });
  return choice === undefined
    ? "The storytree uninstaller is opening: it asks whether to keep your library, then removes the app, its command and its agent connections. Your project folders are left alone."
    : `storytree is uninstalling in the background (${choice === "keep" ? "keeping" : "removing"} your library). It removes the app, its command and its agent connections, and leaves your project folders alone. Restart your agents afterwards.`;
}

/** The registry's raw per-user Path, so %VARIABLES% and its value kind survive the edit. */
const script = (body: string) => Buffer.from(`$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true)\n${body}`, "utf16le").toString("base64");
const powershell = (body: string, env: NodeJS.ProcessEnv = process.env) =>
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", script(body)], { encoding: "utf8", env, windowsHide: true, timeout: 30_000 });
const windowsUserPath: UserPath = {
  readUserPath() {
    if (process.platform !== "win32") return undefined;
    const out = powershell("if ($k -and $k.GetValueNames() -contains 'Path') { 'value:' + $k.GetValue('Path','', 'DoNotExpandEnvironmentNames') }");
    return out.split(/\r?\n/).find((line) => line.startsWith("value:"))?.slice("value:".length);
  },
  writeUserPath(value) {
    // Explorer is told the environment changed, so a newly opened terminal no longer finds storytree.
    powershell(`$k.SetValue('Path', $env:STORYTREE_USER_PATH, $k.GetValueKind('Path'))
Add-Type -Namespace StorytreeUninstall -Name Environment -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hwnd, uint msg, System.UIntPtr wparam, string lparam, uint flags, uint timeout, out System.UIntPtr result);'
$r=[UIntPtr]::Zero
[void][StorytreeUninstall.Environment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r)`, { ...process.env, STORYTREE_USER_PATH: value });
  },
};
