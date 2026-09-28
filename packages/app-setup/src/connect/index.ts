/** Capability 2: per-user agent connection. Setup checks and hook verification stay in agent-link. */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { markDisconnected, registerHooks, removeHooks } from "@storytree/agent-link";
import { claudeSettings, codexSettings, installedToolServerCommand, read, runHarness, type Harness, type InstalledToolServerCommand, type RunHarness, type Settings } from "./harness.js";

export { installedToolServerCommand };
export type { Harness, InstalledToolServerCommand, RunHarness };
export interface ConnectionOptions {
  readonly harnesses: readonly Harness[];
  readonly installed: InstalledToolServerCommand;
  /** Defaults to the current user's home/environment. Explicit values support installed-artifact checks. */
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly run?: RunHarness;
}
export interface ConnectionResult {
  readonly harness: Harness;
  readonly settingsFile: string;
  readonly tools: "connected" | "already connected" | "not connected";
  readonly hooks: "not verified";
  readonly next: string;
}
export interface DisconnectionResult {
  readonly harness: Harness;
  readonly tools: "disconnected" | "not connected" | "kept";
  readonly next: string;
}
export interface DisconnectReport {
  readonly harnesses: readonly DisconnectionResult[];
  readonly command: "removed" | "none" | "kept";
  readonly next: string;
}

function locations(options: ConnectionOptions) {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const codex = env.CODEX_HOME || path.join(home, ".codex");
  // Where storytree keeps what the user disconnected, which the setup check honours.
  const storytree = env.STORYTREE_HOME || path.join(home, ".storytree", "0.3");
  return { home, env, claude, codex, storytree, files: {
    "claude-code": env.CLAUDE_CONFIG_DIR ? path.join(claude, ".claude.json") : path.join(home, ".claude.json"),
    codex: path.join(codex, "config.toml"),
  } };
}
/** The hook the installation carries: its bundled Node and the hook script beside its tool server. */
const hookCommand = (installed: InstalledToolServerCommand) => ({ node: installed.command, script: path.join(path.dirname(installed.args[0]), "storytree-hook.mjs") });
const executable = (harness: Harness) => harness === "claude-code" ? "claude" : "codex";
async function openSettings(harness: Harness, options: ConnectionOptions): Promise<Settings> {
  const where = locations(options);
  return harness === "claude-code" ? claudeSettings(where.files[harness]) : codexSettings(where.files[harness], options.run ?? runHarness, where.env);
}
const conflict = (file: string) => `The existing storytree entry in ${file} is incompatible and was kept (including any 0.2 entry). Review or move that entry yourself before retrying. The name storytree is required by the existing hooks.`;

/**
 * Register the chosen harnesses independently: the tool server and storytree's hooks. The hooks go
 * in now, not at the first session's setup check, because a harness reads its hooks when a session
 * starts: registered later, the first session would miss the start hook that asks the setup question.
 * No app launch, agent session, project creation or hook attestation.
 */
export async function connectAgents(options: ConnectionOptions): Promise<ConnectionResult[]> {
  const where = locations(options);
  const results: ConnectionResult[] = [];
  const hook = hookCommand(options.installed);
  for (const harness of new Set(options.harnesses)) {
    const settingsFile = where.files[harness];
    const result = (tools: ConnectionResult["tools"], next: string) => results.push({ harness, settingsFile, tools, hooks: "not verified", next });
    try {
      const installed = installedToolServerCommand(options.installed.command, options.installed.args[0]);
      if (options.installed.args.length !== 1 || ![installed.command, installed.args[0], hook.script].every((file) => statSync(file).isFile())) throw new Error("Missing installed tools");
    } catch {
      result("not connected", "Re-run the storytree installer to restore its bundled Node and tool server, then retry Connect.");
      continue;
    }
    try {
      await (options.run ?? runHarness)(executable(harness), ["--version"], { cwd: where.home, env: where.env });
    } catch {
      result("not connected", `Install ${harness === "claude-code" ? "Claude Code" : "Codex"}, sign in, and check that ${executable(harness)} --version works in a fresh terminal; reopen storytree and retry Connect.`);
      continue;
    }
    let settings: Settings | undefined;
    let checkingFile = path.join(harness === "claude-code" ? where.claude : where.codex, harness === "claude-code" ? "settings.json" : "hooks.json");
    try {
      const hooksText = read(checkingFile);
      if (hooksText !== undefined) {
        const hooks: unknown = JSON.parse(hooksText);
        if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error("Expected a settings object");
      }
      checkingFile = settingsFile;
      settings = await openSettings(harness, options);
      if (settings.current !== undefined && !settings.compatible(options.installed)) {
        result("not connected", conflict(settingsFile));
        continue;
      }
      const tools = settings.current === undefined ? "connected" : "already connected";
      if (settings.current === undefined) await settings.add(options.installed);
      markDisconnected(where.storytree, harness, false);
      registerHooks(harness === "claude-code" ? { claude: where.claude } : { codex: where.codex }, hook);
      result(tools, "Tools connected in user settings; hooks not verified. Start a new agent session in the folder you want to work on and call check_setup. It asks before creating a project and names each missing hook until its event is received. Project or managed settings can override this user registration.");
    } catch {
      // Do not copy a CLI's stdout/stderr (which can include settings or credentials) into the result.
      const reason = harness === "claude-code" ? " Check that the file contains a valid JSON object." : " Check that codex mcp list --json succeeds and hooks.json contains a valid JSON object.";
      result("not connected", `Repair ${checkingFile} or its write permissions, then retry Connect.${reason}`);
    } finally { settings?.close(); }
  }
  return results;
}

/** Remove only the selected registration and this installation's hooks. Keep the command while another registration may need it. */
export async function disconnectAgents(options: ConnectionOptions): Promise<DisconnectReport> {
  const where = locations(options);
  const harnesses: DisconnectionResult[] = [];
  const hook = hookCommand(options.installed);
  for (const harness of new Set(options.harnesses)) {
    let settings: Settings | undefined;
    try {
      settings = await openSettings(harness, options);
      if (settings.current !== undefined && !settings.compatible(options.installed)) {
        harnesses.push({ harness, tools: "kept", next: conflict(where.files[harness]) });
        continue;
      }
      // Validate/remove only this harness's hooks; never call the unscoped `setup remove` command.
      removeHooks({ claude: where.claude, codex: where.codex }, { harness, hook });
      if (settings.current !== undefined) await settings.remove();
      // So the setup check, run from another harness's session, does not register its hooks again.
      markDisconnected(where.storytree, harness, true);
      harnesses.push({ harness, tools: settings.current === undefined ? "not connected" : "disconnected", next: "Restart this agent to finish disconnecting. Project libraries and unrelated settings were kept." });
    } catch {
      harnesses.push({ harness, tools: "kept", next: `Repair ${where.files[harness]} and ${path.join(harness === "claude-code" ? where.claude : where.codex, harness === "claude-code" ? "settings.json" : "hooks.json")}; for Codex, check codex mcp list --json. Retry Disconnect to finish cleanup.` });
    } finally { settings?.close(); }
  }
  let command: DisconnectReport["command"] = "kept";
  if (harnesses.length > 0 && harnesses.every((result) => result.tools !== "kept")) {
    let remaining = false;
    for (const harness of ["claude-code", "codex"] as const) {
      let settings: Settings | undefined;
      try {
        settings = await openSettings(harness, options);
        // An unknown/conflicting connection is conservatively kept with the shared command.
        remaining ||= settings.current !== undefined;
      } catch { remaining = true; }
      finally { settings?.close(); }
    }
    if (!remaining) {
      try {
        // The existing setup check registers hooks for every detected home, even an unchosen harness.
        for (const harness of ["claude-code", "codex"] as const) removeHooks({ claude: where.claude, codex: where.codex }, { harness, hook });
        command = removeInstalledCommand(where.home, where.env, options.installed);
      } catch { command = "kept"; }
    }
  }
  return { harnesses, command, next: command === "kept" ? "Shared command kept while another connection exists or cleanup cannot be confirmed; retry Disconnect for cleanup when no connection remains." : "All user connections removed. Project libraries and unrelated settings were kept." };
}

function removeInstalledCommand(home: string, env: NodeJS.ProcessEnv, installed: InstalledToolServerCommand): "removed" | "none" {
  const target = path.join(path.dirname(installed.args[0]), "storytree.mjs");
  const marker = "storytree 0.3's command (put here by its setup check)";
  const wanted = process.platform === "win32"
    ? `@echo off\r\nrem ${marker}\r\ngoto #_storytree_handoff_# 2>nul || "${installed.command}" "${target}" %*\r\n`
    : `#!/bin/sh\n# ${marker}\nexec "${installed.command}" "${target}" "$@"\n`;
  let removed = false;
  for (const folder of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const relative = path.relative(home, folder);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const file = path.join(folder, process.platform === "win32" ? "storytree.cmd" : "storytree");
    if (existsSync(file) && readFileSync(file, "utf8") === wanted) { rmSync(file); removed = true; }
  }
  return removed ? "removed" : "none";
}
