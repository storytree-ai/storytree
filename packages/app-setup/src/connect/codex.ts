// Capability 2 · Connect an agent
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { ask, pathEnv } from "@storytree/session-management";

export const CODEX_TRUST_STEP =
  'In Codex, type /hooks and trust storytree\'s hooks (Codex also asks by itself when it starts, as "Hooks need review"), then start a new Codex session.';

export interface CodexOptions {
  readonly path?: string;
  readonly waitMs?: number;
  readonly codexHome?: string;
  readonly localAppData?: string;
  readonly applications?: readonly string[];
}

export function desktopCodex(options: Pick<CodexOptions, "codexHome" | "localAppData" | "applications"> = {}): string[] {
  const codexHome = options.codexHome ?? (process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  const applications = options.applications ?? macApplications();
  const found: string[] = [];
  try {
    const named = /^\s*CODEX_CLI_PATH\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(readFileSync(path.join(codexHome, "config.toml"), "utf8"))?.[1];
    if (named !== undefined) found.push(named.startsWith("'") ? named.slice(1, -1) : (JSON.parse(named) as string));
  } catch {}
  if (localAppData !== undefined) {
    const bin = path.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      for (const hash of readdirSync(bin)) found.push(path.join(bin, hash, "codex.exe"));
    } catch {}
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

const BUNDLED_CODEX: readonly (readonly string[])[] = [
  ["codex-cli", "bin", "codex"],
  ["codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"],
  ["codex"],
];

function macApplications(): string[] {
  return process.platform === "darwin" ? ["/Applications", path.join(homedir(), "Applications")] : [];
}

export function installedCodexVersion(options: CodexOptions = {}): string | undefined {
  const waitMs = options.waitMs ?? 3_000;
  const env = options.path === undefined ? process.env : { ...process.env, PATH: options.path, Path: options.path };
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

export async function runsElevated(options: { readonly path?: string; readonly waitMs?: number } = {}): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const answer = await ask("whoami", ["/groups", "/fo", "csv"], pathEnv(options.path), options.waitMs ?? 5_000);
  return answer.answered && answer.code === 0 && /S-1-16-(12288|16384)\b/.test(answer.out);
}
