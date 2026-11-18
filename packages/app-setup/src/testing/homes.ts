import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { placeTestServer } from "@storytree/project-and-caller/testing/pg";
import { SHELL_GUARD } from "@storytree/session-management";

import type { HookCommand, Homes } from "../setup/index.js";

export const HOOK: HookCommand = { node: process.execPath, script: path.join(tmpdir(), "storytree", "dist", "storytree-hook.mjs") };
export const ANSWERED = {
  gh: async () => "signed in" as const,
  machine: async () => ({ claude: "signed in", codex: "signed in", git: "present", node: { state: "ok", version: "v24.1.0" }, waitMs: 5_000 }) as const,
};

export const CLAUDE_SETTINGS = {
  permissions: { allow: ["Bash(npm test:*)"] },
  model: "opus",
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] },
};
export const CODEX_CONFIG = 'model = "gpt-5"\n\n[mcp_servers.storytree]\ncommand = "node"\nargs = ["storytree-mcp.mjs"]\n';

export interface Home {
  homes: Required<Pick<Homes, "claude" | "codex">>;
  claudeSettings: string;
  codexConfig: string;
  codexHooks: string;
  storytreeHome: string;
}

export function throwawayHome(dir: string): Home {
  const claude = path.join(dir, ".claude");
  const codexHome = path.join(dir, ".codex");
  const storytreeHome = path.join(dir, ".storytree", "0.3");
  for (const folder of [claude, codexHome, storytreeHome]) mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(claude, "settings.json"), `${JSON.stringify(CLAUDE_SETTINGS, null, 2)}\n`);
  writeFileSync(path.join(codexHome, "config.toml"), CODEX_CONFIG);
  placeTestServer(path.join(storytreeHome, "pgdata"));
  return {
    homes: { claude, codex: codexHome },
    claudeSettings: path.join(claude, "settings.json"),
    codexConfig: path.join(codexHome, "config.toml"),
    codexHooks: path.join(codexHome, "hooks.json"),
    storytreeHome,
  };
}

export function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

export interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; args?: string[]; async?: boolean }[];
}

export interface Registered {
  matcher: string;
  background: boolean;
  guard: boolean;
}

export function storytreeHooks(settings: Record<string, unknown>, script: string, harness: string): Record<string, Registered[]> {
  const events = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const found: Record<string, Registered[]> = {};
  for (const [event, entries] of Object.entries(events)) {
    for (const entry of entries) {
      const ours = entry.hooks.find((hook) =>
        hook.args !== undefined ? hook.args[0] === script && hook.args.includes(harness) : hook.command.includes(script) && hook.command.includes(harness),
      );
      if (ours === undefined) continue;
      const background = ours.async === true || (ours.args ?? ours.command.split(" ")).includes("--background");
      (found[event] ??= []).push({ matcher: entry.matcher ?? "", background, guard: (ours.args ?? ours.command.split(" ")).includes(SHELL_GUARD) });
    }
  }
  return found;
}

export function runsFor(entry: Registered | undefined, tool: string, anchored: boolean): boolean {
  return entry !== undefined && new RegExp(anchored ? `^(${entry.matcher})$` : entry.matcher).test(tool);
}
export function fakeTool(bin: string, name: string, answers: Record<string, { out?: string; code: number }>, delaySeconds = 0): void {
  if (process.platform === "win32") {
    const cases = Object.entries(answers).map(([args, { out, code }]) => `if "%*"=="${args}" (${out === undefined ? "" : `echo ${out}& `}exit /b ${code})`);
    const delay = delaySeconds > 0 ? `"%SystemRoot%\\System32\\PING.EXE" -n ${delaySeconds + 1} 127.0.0.1 >nul\r\n` : "";
    writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\n${delay}${cases.join("\r\n")}\r\n"%SystemRoot%\\System32\\PING.EXE" -n 60 127.0.0.1 >nul\r\n`);
  } else {
    const cases = Object.entries(answers).map(([args, { out, code }]) => `if [ "$*" = "${args}" ]; then ${out === undefined ? "" : `echo '${out}'; `}exit ${code}; fi`);
    const delay = delaySeconds > 0 ? `/bin/sleep ${delaySeconds}\n` : "";
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${delay}${cases.join("\n")}\nexec /bin/sleep 60\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
}
