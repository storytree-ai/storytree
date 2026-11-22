// Capability 1 · Get storytree
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { installedToolServerCommand, removeConnections, type InstalledToolServerCommand, type RunHarness } from "../connect/index.js";
import { factoryFolder, locateApp, storytreeHome } from "@storytree/project-and-caller";
import { watchedHarness } from "@storytree/project-and-caller/caller";
import { toolPaths } from "./payload.js";

export type LibraryChoice = "keep" | "remove";
export interface UserPath {
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
  readonly platform?: NodeJS.Platform;
  readonly reportFile?: string;
}
export interface UninstallReport {
  readonly complete: boolean;
  readonly lines: string[];
}

const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function ownsHome(installDir: string, home: string): boolean {
  try {
    const record = JSON.parse(readFileSync(path.join(home, "delivery.json"), "utf8"));
    return record?.schema === 1 && typeof record.installDir === "string" && same(record.installDir, installDir);
  } catch { return false; }
}

function recordedTools(home: string): InstalledToolServerCommand | undefined {
  try {
    const record = JSON.parse(readFileSync(path.join(home, "delivery.json"), "utf8"));
    return installedToolServerCommand(record.tools.node, record.tools.mcp);
  } catch { return undefined; }
}

export function uninstallAsks(installDir: string, home: string): "ask" | "no library" | "not ours" {
  if (!ownsHome(installDir, home)) return "not ours";
  return existsSync(path.join(home, "pgdata")) ? "ask" : "no library";
}

export function withoutPathEntry(current: string, entry: string): string {
  const wanted = withoutTrailingSlashes(entry).toLowerCase();
  return current.split(";").filter((part) => withoutTrailingSlashes(part.trim().replace(/^"|"$/g, "")).toLowerCase() !== wanted).join(";");
}

function withoutTrailingSlashes(folder: string): string {
  let end = folder.length;
  while (end > 0 && (folder[end - 1] === "/" || folder[end - 1] === "\\")) end--;
  return folder.slice(0, end);
}

function updaterCache(installDir: string, localAppData: string | undefined): string | undefined {
  try {
    // eslint-disable-next-line regexp/no-super-linear-backtracking -- the name keeps trailing blanks and, on a dangling quote or a blank value, falls back through backtracking into the leading blanks; no unambiguous pattern reproduces that, and the file is the few-line app-update.yml the installer wrote
    const name = /^updaterCacheDirName:\s*['"]?([^'"\r\n]+)['"]?\s*$/m.exec(readFileSync(path.join(installDir, "resources", "app-update.yml"), "utf8"))?.[1];
    if (name === undefined || localAppData === undefined || name.includes("..") || /[\\/]/.test(name)) return undefined;
    return path.join(localAppData, name);
  } catch { return undefined; }
}

const library = new Set(["pgdata", "pgdata.owner.json", "pgdata.auth", "backups", "settings.json", "machine.json", "project-choice.json", "queued-lines"]);

const PROFILE_MARKER = "# storytree 0.3's command: added by its installer, taken out by storytree setup uninstall";

export function removeMarkedLines(file: string): boolean {
  if (!existsSync(file)) return false;
  const lines = readFileSync(file, "utf8").split("\n");
  const kept = lines.filter((line) => !line.includes(PROFILE_MARKER));
  if (kept.length === lines.length) return false;
  writeFileSync(file, kept.join("\n"));
  return true;
}

function removeLinuxInstallation(installDir: string, userHome: string, lines: string[]): boolean {
  const profile = path.join(userHome, ".profile");
  try {
    if (removeMarkedLines(profile)) lines.push("The storytree command is off your PATH from your next login.");
    remove(path.join(userHome, ".local", "share", "applications", "storytree-0.3.desktop"));
    remove(installDir);
    lines.push(`The app and its menu entry were removed from ${path.dirname(installDir)}.`);
    return true;
  } catch {
    lines.push(`Remove ${installDir}, ~/.local/share/applications/storytree-0.3.desktop and the line marked "storytree setup uninstall" in ${profile}.`);
    return false;
  }
}

function removeMacInstallation(installDir: string, userHome: string, env: NodeJS.ProcessEnv, lines: string[]): boolean {
  const profile = path.join(env.ZDOTDIR || userHome, ".zprofile");
  try {
    if (removeMarkedLines(profile)) lines.push("The storytree command is off your PATH from your next Terminal window.");
    remove(installDir);
    lines.push(`The app was removed from ${path.dirname(installDir)}.`);
    return true;
  } catch {
    lines.push(`Move ${installDir} to the Bin and remove the line marked "storytree setup uninstall" in ${profile}.`);
    return false;
  }
}

export const uninstallReportFile = () => path.join(tmpdir(), "storytree-uninstall.txt");

function writeReport(file: string, installDir: string, report: UninstallReport): void {
  try {
    writeFileSync(file, [
      `storytree's uninstall, ${new Date().toISOString()}`,
      ...report.lines,
      report.complete ? "Everything storytree added was removed, or goes with the app's folder." : "Something storytree added is still there: each line above says how to remove it.",
      `The uninstall is finished when ${installDir} is gone.`,
      "",
    ].join("\n"));
  } catch {}
}

const remove = (target: string) => rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

function defaultFactory(home: string): string | undefined {
  try {
    const factory = factoryFolder(home);
    return factory.chosen ? undefined : factory.folder;
  } catch { return undefined; }
}

function holdsNoFiles(folder: string): boolean {
  return readdirSync(folder, { withFileTypes: true }).every((entry) => entry.isDirectory() && holdsNoFiles(path.join(folder, entry.name)));
}

export async function uninstall(options: UninstallOptions): Promise<UninstallReport> {
  const report = await removeInstallation(options);
  if (options.reportFile !== undefined) writeReport(options.reportFile, options.installDir, report);
  return report;
}

async function removeInstallation(options: UninstallOptions): Promise<UninstallReport> {
  const lines: string[] = [];
  let complete = true;
  const tools = toolPaths(options.installDir, options.platform);
  const recorded = ownsHome(options.installDir, options.home) ? recordedTools(options.home) : undefined;
  const connections = await removeConnections({
    installed: installedToolServerCommand(tools.node, tools.mcp),
    ...(recorded === undefined ? {} : { also: [recorded] }),
    installDir: options.installDir,
    ...(options.userHome === undefined ? {} : { home: options.userHome }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.run === undefined ? {} : { run: options.run }),
  });
  for (const result of connections) {
    const name = watchedHarness(result.harness)?.label ?? result.harness;
    if (result.tools === "kept") { complete = false; lines.push(`${name}: ${result.next}`); }
    else if (result.tools === "removed") lines.push(`${name}: storytree's connection, hooks and status line removed.`);
  }
  if (!ownsHome(options.installDir, options.home)) return { complete, lines };

  const platform = options.platform ?? process.platform;
  if (platform === "linux") {
    if (!removeLinuxInstallation(options.installDir, options.userHome ?? homedir(), lines)) complete = false;
  } else if (platform === "darwin") {
    if (!removeMacInstallation(options.installDir, options.userHome ?? homedir(), options.env ?? process.env, lines)) complete = false;
  } else {
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
  }

  try {
    if (options.library === "keep") {
      for (const name of readdirSync(options.home)) if (!library.has(name)) remove(path.join(options.home, name));
      lines.push(`Your library was kept in ${options.home}. Reinstalling storytree picks it up again; delete that folder to remove it.`);
    } else {
      const factory = defaultFactory(options.home);
      remove(options.home);
      if (factory !== undefined && existsSync(factory)) {
        if (holdsNoFiles(factory)) remove(factory);
        else lines.push(`Your factory was kept in ${factory}: it holds your own plugins. Delete that folder to remove it.`);
      }
      const parent = path.dirname(options.home);
      if (path.basename(parent) === ".storytree" && existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent);
      lines.push("storytree's home and library were removed.");
    }
  } catch {
    complete = false;
    lines.push(`Some of ${options.home} was in use and stayed; delete it after restarting ${platform === "win32" ? "Windows" : "the computer"}.`);
  }
  return { complete, lines };
}

export async function openUninstaller(choice?: string, helperDir = path.dirname(process.argv[1] ?? ""), host: Partial<Omit<UninstallOptions, "installDir" | "library">> = {}): Promise<string> {
  if (choice !== undefined && choice !== "keep" && choice !== "remove") throw new Error("usage: storytree setup uninstall [--keep-library|--remove-library]");
  const platform = host.platform ?? process.platform;
  const installDir = path.resolve(helperDir, "..", "..", ...(platform === "darwin" ? [".."] : []));
  if (platform === "linux" || platform === "darwin") {
    const home = host.home ?? storytreeHome();
    const asks = uninstallAsks(installDir, home);
    if (asks === "not ours") throw new Error(`${installDir} is not the storytree installation recorded in ${path.join(home, "delivery.json")}; run that installation's storytree setup uninstall. Nothing was removed.`);
    if (asks === "ask" && choice === undefined) throw new Error(`Your library is in ${home}. Run storytree setup uninstall --keep-library or --remove-library. Nothing was removed.`);
    if (locateApp(home).running) throw new Error("storytree is running: Quit storytree from its window or tray, then run storytree setup uninstall again. Nothing was removed.");
    const report = await uninstall({ ...host, installDir, home, library: choice ?? "remove" });
    const said = [...report.lines, "Your project folders were left alone. Restart your agents afterwards."].join("\n");
    if (!report.complete) throw new Error(said);
    return said;
  }
  const uninstaller = path.join(installDir, "Uninstall storytree-0.3.exe");
  // eslint-disable-next-line storytree/host-platform-under-given -- the Windows uninstaller .exe can be spawned only on a real Windows host, whatever platform the uninstall acts for.
  if (process.platform !== "win32" || !existsSync(uninstaller)) {
    throw new Error(`This storytree has no Windows uninstaller at ${uninstaller}; only the installed Windows app has one. Your projects are not affected either way.`);
  }
  const args = ["/currentuser", ...(choice === undefined ? [] : ["/S", `--${choice}-library`])];
  rmSync(uninstallReportFile(), { force: true });
  const child = spawn(uninstaller, args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); }); });
  return choice === undefined
    ? "The storytree uninstaller is opening: it asks whether to keep your library, then removes the app, its command and its agent connections. Your project folders are left alone."
    : `storytree is uninstalling in the background (${choice === "keep" ? "keeping" : "removing"} your library). It removes the app, its command and its agent connections, and leaves your project folders alone. It is finished when ${installDir} is gone, usually within a few minutes; ${uninstallReportFile()} then says what it removed and anything it could not. Restart your agents afterwards.`;
}

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
    powershell(`$k.SetValue('Path', $env:STORYTREE_USER_PATH, $k.GetValueKind('Path'))
Add-Type -Namespace StorytreeUninstall -Name Environment -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hwnd, uint msg, System.UIntPtr wparam, string lparam, uint flags, uint timeout, out System.UIntPtr result);'
$r=[UIntPtr]::Zero
[void][StorytreeUninstall.Environment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r)`, { ...process.env, STORYTREE_USER_PATH: value });
  },
};
