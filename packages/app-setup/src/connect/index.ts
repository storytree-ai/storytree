/** Capability 2 · Connect an agent: per-user agent connection. The setup check and hook verification are capability 8 (setup/). */
import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { codexHookTrust, removeCodexInstructions, writeCodexInstructions } from "@storytree/agent-link";

import { CODEX_TRUST_STEP, launcherFiles, launcherRuns, markDisconnected, registerHooks, removeHooks, removeLauncher, runsElevated } from "../setup/index.js";
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
  /** Whether this runs as a Windows administrator, where Codex cannot run commands. By default, asked of Windows. */
  readonly elevated?: () => Promise<boolean>;
}
export interface ConnectionResult {
  readonly harness: Harness;
  readonly settingsFile: string;
  readonly tools: "connected" | "already connected" | "not connected";
  /**
   * Codex runs storytree's hooks only once the user trusts them, which only a hook that has run proves:
   * until then its hooks wait for the user. Claude Code's are verified inside a session by check_setup.
   */
  readonly hooks: "not verified" | "waiting for you to trust them in Codex" | "running";
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
  return harness === "claude-code" ? claudeSettings(where.files[harness]) : codexSettings(where.files[harness], options.run ?? runHarness, where.env, where.codex === path.join(where.home, ".codex") ? undefined : where.codex);
}
const ELEVATED = "This terminal runs as administrator, and Codex cannot run commands when started from one (its Windows sandbox times out on each): open Codex from a normal terminal, not \"Run as administrator\".";
const conflict = (file: string) => `The existing storytree entry in ${file} is incompatible and was kept (including any 0.2 entry). Review or move that entry yourself before retrying. The name storytree is required by the existing hooks.`;

/**
 * Register the chosen harnesses independently: the tool server and storytree's hooks. The hooks go
 * in now, not at the first session's setup check, because a harness reads its hooks when a session
 * starts: registered later, the first session would miss its start hook.
 * No app launch, agent session, project creation or hook attestation.
 */
export async function connectAgents(options: ConnectionOptions): Promise<ConnectionResult[]> {
  const where = locations(options);
  const results: ConnectionResult[] = [];
  // Codex's own limit, which storytree only names: started from an administrator terminal, it runs no command (agent link 8.17).
  const elevated = options.harnesses.includes("codex") && await (options.elevated ?? runsElevated)().catch(() => false);
  const hook = hookCommand(options.installed);
  for (const harness of new Set(options.harnesses)) {
    const settingsFile = where.files[harness];
    const result = (tools: ConnectionResult["tools"], next: string, hooks: ConnectionResult["hooks"] = "not verified") => results.push({ harness, settingsFile, tools, hooks, next: harness === "codex" && elevated ? `${next} ${ELEVATED}` : next });
    try {
      const installed = installedToolServerCommand(options.installed.command, options.installed.args[0]);
      if (options.installed.args.length !== 1 || ![installed.command, installed.args[0]].every((file) => statSync(file).isFile())) throw new Error("Missing installed tools");
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
    const harnessHome = harness === "claude-code" ? where.claude : where.codex;
    const hooksFile = path.join(harnessHome, harness === "claude-code" ? "settings.json" : "hooks.json");
    let checkingFile = hooksFile;
    try {
      // A harness that has never started a session has no home yet (its --version makes none): make it, so its hooks go in now.
      mkdirSync(harnessHome, { recursive: true });
      const hooksText = read(checkingFile);
      if (hooksText !== undefined) {
        const hooks: unknown = JSON.parse(hooksText);
        if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error("Expected a settings object");
      }
      checkingFile = settingsFile;
      settings = await openSettings(harness, options);
      const outdated = settings.current !== undefined && settings.outdated(options.installed);
      if (settings.current !== undefined && !outdated && !settings.compatible(options.installed)) {
        result("not connected", conflict(settingsFile));
        continue;
      }
      const tools = settings.current === undefined || outdated ? "connected" : "already connected";
      if (outdated) await settings.update(options.installed);
      else if (settings.current === undefined) await settings.add(options.installed);
      markDisconnected(where.storytree, harness, false);
      checkingFile = hooksFile;
      const registration = registerHooks(harness === "claude-code" ? { claude: where.claude } : { codex: where.codex }, hook)[harness];
      if (registration !== "registered" && registration !== "already registered") throw new Error(`Hooks ${registration}`);
      // Codex shows the agent neither the tool server's instructions nor its tools until it searches, and
      // runs no hook until the user trusts it: its home's AGENTS.md is what sends its first session to check_setup.
      if (harness === "codex") writeCodexInstructions(where.codex);
      const trust = harness === "codex" ? codexHookTrust({ storytreeHome: where.storytree, codexHome: where.codex }) : "not registered";
      if (trust === "running") result(tools, "Tools connected in user settings; Codex has run storytree's hooks. Start a new Codex session in the folder of your project.", "running");
      else if (trust === "waiting") result(tools, `Tools connected in user settings. One step is yours: Codex runs storytree's hooks only once you have trusted them, and until then storytree cannot see Codex's work. ${CODEX_TRUST_STEP}`, "waiting for you to trust them in Codex");
      else result(tools, "Tools connected in user settings; hooks not verified. Start a new agent session in the folder of your project and call check_setup; it names each missing hook until its event is received. Project or managed settings can override this user registration.");
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
      if (harness === "codex") removeCodexInstructions(where.codex);
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
        removeCodexInstructions(where.codex);
        command = removeInstalledCommand(where.home, where.env, options.installed);
      } catch { command = "kept"; }
    }
  }
  return { harnesses, command, next: command === "kept" ? "Shared command kept while another connection exists or cleanup cannot be confirmed; retry Disconnect for cleanup when no connection remains." : "All user connections removed. Project libraries and unrelated settings were kept." };
}

export interface RemovalResult {
  readonly harness: Harness;
  readonly tools: "removed" | "none" | "kept";
  readonly next?: string;
}

/**
 * Uninstalling: take out this installation's registration, hooks and status line from both agents,
 * whichever were chosen. Anything that does not run this installation's tools (another build's, 0.2's,
 * the user's own) is not ours and stays, silently. Records no disconnection, since the home goes too.
 */
export async function removeConnections(options: Omit<ConnectionOptions, "harnesses">): Promise<RemovalResult[]> {
  const where = locations({ ...options, harnesses: [] });
  const hook = hookCommand(options.installed);
  const results: RemovalResult[] = [];
  for (const harness of ["claude-code", "codex"] as const) {
    let settings: Settings | undefined;
    try {
      removeHooks({ claude: where.claude, codex: where.codex }, { harness, hook });
      if (harness === "codex") removeCodexInstructions(where.codex);
      // Codex's own command line reads its TOML; without a storytree table there is nothing to ask it.
      if (harness === "codex" && !/mcp_servers\.["']?storytree\b/.test(read(where.files.codex) ?? "")) { results.push({ harness, tools: "none" }); continue; }
      settings = await openSettings(harness, { ...options, harnesses: [] });
      const ours = settings.current !== undefined && settings.compatible(options.installed);
      if (ours) await settings.remove();
      results.push({ harness, tools: ours ? "removed" : "none" });
    } catch {
      const next = harness === "claude-code"
        ? `remove the storytree entry under mcpServers in ${where.files[harness]}, and storytree's hooks and status line in ${path.join(where.claude, "settings.json")}.`
        : `run codex mcp remove storytree, or delete the [mcp_servers.storytree] table in ${where.files[harness]}; storytree's hooks are in ${path.join(where.codex, "hooks.json")}.`;
      results.push({ harness, tools: "kept", next: `storytree could not remove its connection; ${next}` });
    } finally { settings?.close(); }
  }
  return results;
}

/** This installation's own launchers in the user's home: any of storytree's (the batch file before ADR-0854 too) that runs its Node and command. */
function removeInstalledCommand(home: string, env: NodeJS.ProcessEnv, installed: InstalledToolServerCommand): "removed" | "none" {
  const target = path.join(path.dirname(installed.args[0]), "storytree.mjs");
  let removed = false;
  for (const folder of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const relative = path.relative(home, folder);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    for (const name of launcherFiles()) {
      const file = path.join(folder, name);
      const runs = launcherRuns(file);
      if (runs?.node === installed.command && runs.target === target) { removeLauncher(file); removed = true; }
    }
  }
  return removed ? "removed" : "none";
}
