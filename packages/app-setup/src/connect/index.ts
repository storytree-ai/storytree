/** Capability 2 · Connect an agent: per-user agent connection. The setup check and hook verification are capability 8 (setup/). */
import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ANTIGRAVITY_HOOKS, codexHookTrust, PI_EXTENSION } from "@storytree/session-management";
import { HARNESS_IDS, watchedHarness } from "@storytree/project-and-caller/caller";

import { CODEX_TRUST_STEP, installedCodexVersion, launcherFiles, launcherRuns, markDisconnected, registerHooks, removeHooks, removeLauncher, runsElevated } from "../setup/index.js";
import { removeCodexInstructions, writeCodexInstructions } from "./codex-agents.js";
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
  // Cursor's home is ~/.cursor on every machine: no variable moves it (its documentation; not measured in a live session).
  const cursor = path.join(home, ".cursor");
  // Pi's agent folder: PI_CODING_AGENT_DIR, else ~/.pi/agent (measured, Pi 1.1.0).
  const pi = env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
  // Antigravity CLI's home is ~/.gemini; its tool servers are in config/mcp_config.json (measured, agy 1.3.3).
  const antigravity = path.join(home, ".gemini");
  return { home, env, claude, codex, cursor, pi, antigravity, storytree, files: {
    "claude-code": env.CLAUDE_CONFIG_DIR ? path.join(claude, ".claude.json") : path.join(home, ".claude.json"),
    codex: path.join(codex, "config.toml"),
    cursor: path.join(cursor, "mcp.json"),
    pi: path.join(pi, "mcp.json"),
    antigravity: path.join(antigravity, "config", "mcp_config.json"),
  } };
}
/** The hook the installation carries: its bundled Node and the hook script beside its tool server. */
const hookCommand = (installed: InstalledToolServerCommand) => ({ node: installed.command, script: path.join(path.dirname(installed.args[0]), "storytree-hook.mjs") });
const executable = (harness: Harness) => harness === "claude-code" ? "claude" : harness === "codex" ? "codex" : harness === "pi" ? "pi" : harness === "antigravity" ? "agy" : "cursor-agent";
const label = (harness: Harness) => watchedHarness(harness)?.label ?? harness;
/** The file a harness keeps its hooks in: Claude Code's settings.json, Codex's, Cursor's and Antigravity's hooks.json, and storytree's Pi extension. */
const hooksFileOf = (where: ReturnType<typeof locations>, harness: Harness) => harness === "claude-code" ? path.join(where.claude, "settings.json") : harness === "pi" ? path.join(where.pi, PI_EXTENSION) : harness === "antigravity" ? path.join(where.antigravity, ANTIGRAVITY_HOOKS) : path.join(where[harness], "hooks.json");
/** The folder a harness keeps its hooks file in: its home, for Pi its agent folder, which holds the extensions folder, and for Antigravity ~/.gemini, which holds its config folder. */
const harnessHomeOf = (where: ReturnType<typeof locations>, harness: Harness) => harness === "pi" ? where.pi : harness === "antigravity" ? where.antigravity : path.dirname(hooksFileOf(where, harness));
const homesOf = (where: ReturnType<typeof locations>) => ({ claude: where.claude, codex: where.codex, cursor: where.cursor, pi: where.pi, antigravity: where.antigravity });
/** Pi's default exposure, codemode, declares no tool to the model: storytree's are declared directly (measured, Pi 1.1.0). */
const PI_ENTRY = { exposure: "direct", description: "storytree: the project's plan, claims, library and questions" };
async function openSettings(harness: Harness, options: ConnectionOptions): Promise<Settings> {
  const where = locations(options);
  // Cursor's mcp.json names its servers under mcpServers, as Claude Code's file does.
  return harness !== "codex" ? claudeSettings(where.files[harness], harness === "pi" ? PI_ENTRY : {}) : codexSettings(where.files[harness], options.run ?? runHarness, where.env, where.codex === path.join(where.home, ".codex") ? undefined : where.codex);
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
  // Codex's own limit, which storytree only names: started from an administrator terminal, it runs no command (Session management 8.17).
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
      result("not connected", `Install ${label(harness)}, sign in, and check that ${executable(harness)} --version works in a fresh terminal; reopen storytree and retry Connect.`);
      continue;
    }
    let settings: Settings | undefined;
    const hooksFile = hooksFileOf(where, harness);
    const harnessHome = harnessHomeOf(where, harness);
    let checkingFile = hooksFile;
    try {
      // A harness that has never started a session has no home yet (its --version makes none): make it, so its hooks go in now.
      mkdirSync(harnessHome, { recursive: true });
      // Pi's is an extension storytree writes whole, not a settings file.
      const hooksText = harness === "pi" ? undefined : read(checkingFile);
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
      // Codex's hooks take the shape its version runs (hooks-config.ts), asked of the Codex these settings' PATH finds.
      const codexVersion = harness === "codex" ? installedCodexVersion({ codexHome: where.codex, ...(where.env.PATH === undefined ? {} : { path: where.env.PATH }) }) : undefined;
      const registration = registerHooks(harness === "claude-code" ? { claude: where.claude } : { [harness]: harnessHome }, hook, undefined, codexVersion)[harness];
      if (registration !== "registered" && registration !== "already registered") throw new Error(`Hooks ${registration}`);
      // Codex shows the agent neither the tool server's instructions nor its tools until it searches, and
      // runs no hook until the user trusts it: its home's AGENTS.md is what sends its first session to check_setup.
      // Pi shows the agent no server instructions in either exposure (measured, Pi 1.1.0), and reads its agent folder's AGENTS.md in every folder.
      if (harness === "codex" || harness === "pi") writeCodexInstructions(harnessHome);
      const trust = harness === "codex" ? codexHookTrust({ storytreeHome: where.storytree, codexHome: where.codex }) : "not registered";
      if (trust === "running") result(tools, "Tools connected in user settings; Codex has run storytree's hooks. Start a new Codex session in the folder of your project.", "running");
      else if (trust === "waiting") result(tools, `Tools connected in user settings. One step is yours: Codex runs storytree's hooks only once you have trusted them, and until then storytree cannot see Codex's work. ${CODEX_TRUST_STEP}`, "waiting for you to trust them in Codex");
      // Cursor's hooks are known from its documentation and code, not from a session: nothing here says they run.
      else if (harness === "cursor") result(tools, "Tools connected in user settings; hooks not verified. Start a new Cursor agent session in the folder of your project and call check_setup.");
      // Antigravity's hooks are known from the documentation it ships, not from a session (agy runs no prompt unsigned).
      else if (harness === "antigravity") result(tools, "Tools connected in user settings and storytree's hooks added to Antigravity's hooks.json; hooks not verified. Start a new agy session in the folder of your project and call check_setup.");
      else if (harness === "pi") result(tools, "Tools connected in user settings and storytree's Pi extension installed; hooks not verified. Start a new Pi session in the folder of your project and call check_setup.");
      else result(tools, "Tools connected in user settings; hooks not verified. Start a new agent session in the folder of your project and call check_setup; it names each missing hook until its event is received. Project or managed settings can override this user registration.");
    } catch {
      // Do not copy a CLI's stdout/stderr (which can include settings or credentials) into the result.
      const reason = harness === "codex" ? " Check that codex mcp list --json succeeds and hooks.json contains a valid JSON object." : " Check that the file contains a valid JSON object.";
      result("not connected", `Repair ${checkingFile} or its write permissions, then retry Connect.${reason}`);
    } finally { settings?.close(); }
  }
  return results;
}

/** An agent this computer runs, and whether this installation's tool server is already registered with it. */
export interface FoundAgent {
  readonly harness: Harness;
  readonly agent: string;
  readonly connected: boolean;
}

/**
 * The agents whose command runs here (its `--version`), each said connected or not, so the app's first run can offer
 * to connect the rest (ADR-1162 D3). An agent whose settings cannot be read is said not connected; connecting it names the fix.
 */
export async function agentsOnThisComputer(options: Omit<ConnectionOptions, "harnesses">): Promise<FoundAgent[]> {
  const where = locations({ ...options, harnesses: [] });
  const found: FoundAgent[] = [];
  for (const harness of HARNESS_IDS) {
    try { await (options.run ?? runHarness)(executable(harness), ["--version"], { cwd: where.home, env: where.env }); } catch { continue; }
    let settings: Settings | undefined;
    let connected = false;
    try {
      settings = await openSettings(harness, { ...options, harnesses: [harness] });
      connected = settings.current !== undefined && settings.compatible(options.installed);
    } catch { /* Unreadable settings: offered, and Connect says how to repair them. */ } finally { settings?.close(); }
    found.push({ harness, agent: label(harness), connected });
  }
  return found;
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
      // An outdated registration is still this installation's, only older: it goes too.
      if (settings.current !== undefined && !settings.compatible(options.installed) && !settings.outdated(options.installed)) {
        harnesses.push({ harness, tools: "kept", next: conflict(where.files[harness]) });
        continue;
      }
      // Validate/remove only this harness's hooks; never call the unscoped `setup remove` command.
      removeHooks(homesOf(where), { harness, hook });
      if (harness === "codex" || harness === "pi") removeCodexInstructions(harnessHomeOf(where, harness));
      if (settings.current !== undefined) await settings.remove();
      // So the setup check, run from another harness's session, does not register its hooks again.
      markDisconnected(where.storytree, harness, true);
      harnesses.push({ harness, tools: settings.current === undefined ? "not connected" : "disconnected", next: "Restart this agent to finish disconnecting. Project libraries and unrelated settings were kept." });
    } catch {
      harnesses.push({ harness, tools: "kept", next: `Repair ${where.files[harness]} and ${hooksFileOf(where, harness)}; for Codex, check codex mcp list --json. Retry Disconnect to finish cleanup.` });
    } finally { settings?.close(); }
  }
  let command: DisconnectReport["command"] = "kept";
  if (harnesses.length > 0 && harnesses.every((result) => result.tools !== "kept")) {
    let remaining = false;
    for (const harness of HARNESS_IDS) {
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
        for (const harness of HARNESS_IDS) removeHooks(homesOf(where), { harness, hook });
        removeCodexInstructions(where.codex);
        removeCodexInstructions(where.pi);
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
 * Uninstalling: take out this installation's registration, hooks and status line from every agent,
 * whichever were chosen. Anything that does not run this installation's tools (another build's, 0.2's,
 * the user's own) is not ours and stays, silently. Records no disconnection, since the home goes too.
 */
export async function removeConnections(options: Omit<ConnectionOptions, "harnesses">): Promise<RemovalResult[]> {
  const where = locations({ ...options, harnesses: [] });
  const hook = hookCommand(options.installed);
  const results: RemovalResult[] = [];
  for (const harness of HARNESS_IDS) {
    let settings: Settings | undefined;
    try {
      removeHooks(homesOf(where), { harness, hook });
      if (harness === "codex" || harness === "pi") removeCodexInstructions(harnessHomeOf(where, harness));
      // Codex's own command line reads its TOML; without a storytree table there is nothing to ask it.
      if (harness === "codex" && !/mcp_servers\.["']?storytree\b/.test(read(where.files.codex) ?? "")) { results.push({ harness, tools: "none" }); continue; }
      settings = await openSettings(harness, { ...options, harnesses: [] });
      const ours = settings.current !== undefined && (settings.compatible(options.installed) || settings.outdated(options.installed));
      if (ours) await settings.remove();
      results.push({ harness, tools: ours ? "removed" : "none" });
    } catch {
      const next = harness === "claude-code"
        ? `remove the storytree entry under mcpServers in ${where.files[harness]}, and storytree's hooks and status line in ${path.join(where.claude, "settings.json")}.`
        : harness === "cursor" || harness === "pi" || harness === "antigravity"
          ? `remove the storytree entry under mcpServers in ${where.files[harness]}, and storytree's hooks in ${hooksFileOf(where, harness)}.`
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
