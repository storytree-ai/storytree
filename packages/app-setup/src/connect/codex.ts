/**
 * Capability 2 · Connect an agent. What connecting Codex asks of the machine: where its CLI is and which version it is,
 * whether this runs as a Windows administrator, and the one step that lets Codex run storytree's hooks. The setup check
 * asks the same of Codex, from here.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ask, pathEnv } from "@storytree/session-management";

/**
 * The one step that lets Codex run storytree's hooks, in words for the user: shown at connect, in the
 * app and by the setup check alike (8.16). Codex asks by itself when it starts; /hooks asks again.
 */
export const CODEX_TRUST_STEP =
  'In Codex, type /hooks and trust storytree\'s hooks (Codex also asks by itself when it starts, as "Hooks need review"), then start a new Codex session.';

export interface CodexOptions {
  /** The PATH to find the tools on; by default, this process's. */
  readonly path?: string;
  /** How long to give each tool to answer. */
  readonly waitMs?: number;
  /** Codex's home, whose config.toml may name where its CLI is (CODEX_CLI_PATH). By default, CODEX_HOME or ~/.codex. */
  readonly codexHome?: string;
  /** Where Windows keeps a user's apps (%LOCALAPPDATA%), under which the Codex desktop app installs its CLI. By default, LOCALAPPDATA. */
  readonly localAppData?: string;
  /** Where macOS keeps apps, in which the Codex or ChatGPT app bundles its CLI. By default, /Applications and ~/Applications on a Mac, none elsewhere. */
  readonly applications?: readonly string[];
}

/**
 * Where a Codex off the PATH may be: the Codex desktop app puts its CLI at
 * %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe and names it as CODEX_CLI_PATH in Codex's
 * config.toml, and puts neither on the PATH (increment_820b7d460eb9). On a Mac the Codex app, or the
 * ChatGPT app it merged into, bundles it in one of {@link BUNDLED_CODEX}'s places (increment_ebe913930972).
 */
export function desktopCodex(options: Pick<CodexOptions, "codexHome" | "localAppData" | "applications"> = {}): string[] {
  const codexHome = options.codexHome ?? (process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  const applications = options.applications ?? macApplications();
  const found: string[] = [];
  try {
    const named = /^\s*CODEX_CLI_PATH\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(readFileSync(path.join(codexHome, "config.toml"), "utf8"))?.[1];
    if (named !== undefined) found.push(named.startsWith("'") ? named.slice(1, -1) : (JSON.parse(named) as string));
  } catch {
    // No config, or no path in it that reads.
  }
  if (localAppData !== undefined) {
    const bin = path.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      for (const hash of readdirSync(bin)) found.push(path.join(bin, hash, "codex.exe"));
    } catch {
      // No desktop app here.
    }
  }
  for (const folder of applications) {
    for (const app of ["Codex.app", "ChatGPT.app"]) {
      for (const layout of BUNDLED_CODEX) {
        const file = path.join(folder, app, "Contents", "Resources", ...layout);
        if (existsSync(file)) found.push(file);
      }
    }
  }
  return found;
}

/**
 * Where a Mac app bundle has kept Codex's CLI under Contents/Resources, newest first: codex-cli's
 * bin/codex and CodexCLI.app since app 26.924 moved it (openai/codex#48214), a bare codex before.
 */
const BUNDLED_CODEX: readonly (readonly string[])[] = [
  ["codex-cli", "bin", "codex"],
  ["codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"],
  ["codex"],
];

function macApplications(): string[] {
  return process.platform === "darwin" ? ["/Applications", path.join(homedir(), "Applications")] : [];
}

/**
 * The version Codex says it is (`codex --version`), on the PATH or else where its desktop app keeps it; undefined where
 * none answers within `waitMs`. Asked while hooks are registered, which is synchronous: the shape of Codex's hooks
 * depends on it (hooks-config.ts).
 */
export function installedCodexVersion(options: CodexOptions = {}): string | undefined {
  const waitMs = options.waitMs ?? 3_000;
  const env = options.path === undefined ? process.env : { ...process.env, PATH: options.path, Path: options.path };
  // The npm install of Codex is a .cmd on Windows, which only a shell runs; the desktop app's is an .exe, run with none.
  // A shell is handed one command line, never arguments beside it, which Node deprecates (DEP0190).
  const asked = (command: string, shell: boolean) => shell
    ? spawnSync(`${command} --version`, { env, timeout: waitMs, encoding: "utf8", shell, windowsHide: true })
    : spawnSync(command, ["--version"], { env, timeout: waitMs, encoding: "utf8", windowsHide: true });
  for (const [command, shell] of [["codex", process.platform === "win32"] as const, ...desktopCodex(options).map((file) => [file, false] as const)]) {
    const answer = asked(command, shell);
    const version = answer.status === 0 ? /\d+\.\d+\.\d+/.exec(answer.stdout)?.[0] : undefined;
    if (version !== undefined) return version;
  }
  return undefined;
}

/**
 * Whether this process runs as a Windows administrator (8.17), read from its integrity label: an administrator's elevated
 * token is labelled high (S-1-16-12288) or system (S-1-16-16384), a normal desktop session medium. Measured on the owner's
 * laptop, 2026-09-30: an SSH login as an administrator is high, the desktop session medium. Never so elsewhere.
 */
export async function runsElevated(options: { readonly path?: string; readonly waitMs?: number } = {}): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const answer = await ask("whoami", ["/groups", "/fo", "csv"], pathEnv(options.path), options.waitMs ?? 5_000);
  return answer.answered && answer.code === 0 && /S-1-16-(12288|16384)\b/.test(answer.out);
}
