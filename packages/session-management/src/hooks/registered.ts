/**
 * Capability 3 · Hooks. Which hook scripts the harnesses on this machine run: read from Claude Code's settings.json and
 * Codex's, Cursor's and Antigravity CLI's hooks.json, and from storytree's Pi extension, so the worktree reaper never deletes the build a harness runs. Writing those files is the
 * app setup story's (ADR-0969 D3); it reads them through this.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Where each harness keeps its settings: Claude Code's config folder (~/.claude), Codex's home (~/.codex), Cursor's (~/.cursor), Pi's agent folder (~/.pi/agent) and Antigravity CLI's (~/.gemini). */
export interface Homes {
  readonly claude?: string;
  readonly codex?: string;
  readonly cursor?: string;
  readonly pi?: string;
  readonly antigravity?: string;
}

/** The harnesses' homes on this machine: CLAUDE_CONFIG_DIR or ~/.claude, CODEX_HOME or ~/.codex, ~/.cursor, which no variable moves, PI_CODING_AGENT_DIR or ~/.pi/agent, and ~/.gemini, which no documented variable moves. */
export function defaultHomes(env: Readonly<Record<string, string | undefined>> = process.env): Required<Homes> {
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"),
    codex: env.CODEX_HOME || path.join(homedir(), ".codex"),
    cursor: path.join(homedir(), ".cursor"),
    pi: env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"),
    antigravity: path.join(homedir(), ".gemini"),
  };
}

/** Antigravity CLI's user-level hooks file, in its home (measured: agy 1.3.3 loads it at startup). Its tool servers are beside it, in mcp_config.json. */
export const ANTIGRAVITY_HOOKS = path.join("config", "hooks.json");

/** Storytree's Pi extension, in Pi's agent folder: where it is, and the line naming the hook script it runs, which the app setup writes. */
export const PI_EXTENSION = path.join("extensions", "storytree.ts");
export const PI_EXTENSION_SCRIPT = "const SCRIPT = ";

/** The hook script storytree's Pi extension `text` runs, or undefined when it names none. */
export function piExtensionScript(text: string): string | undefined {
  const line = text.split("\n").find((one) => one.startsWith(PI_EXTENSION_SCRIPT));
  try {
    const script: unknown = line === undefined ? undefined : JSON.parse(line.slice(PI_EXTENSION_SCRIPT.length).replace(/;\s*$/, ""));
    return typeof script === "string" ? script : undefined;
  } catch {
    return undefined;
  }
}

/** The hook scripts Claude Code's settings.json, Codex's and Cursor's hooks.json and storytree's Pi extension register, as paths: none from a file missing or unreadable. */
export function registeredHookScripts(homes: Homes = defaultHomes()): string[] {
  const scripts: string[] = [];
  if (homes.pi !== undefined) {
    try {
      const script = piExtensionScript(readFileSync(path.join(homes.pi, PI_EXTENSION), "utf8"));
      if (script !== undefined) scripts.push(script);
    } catch {
      // No extension of storytree's here.
    }
  }
  for (const file of [homes.claude && path.join(homes.claude, "settings.json"), homes.codex && path.join(homes.codex, "hooks.json"), homes.cursor && path.join(homes.cursor, "hooks.json"), homes.antigravity && path.join(homes.antigravity, ANTIGRAVITY_HOOKS)]) {
    if (file === undefined) continue;
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (value !== null && typeof value === "object") for (const inner of Object.values(value)) collect(inner);
    };
    try {
      collect(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      continue;
    }
    scripts.push(...scriptsIn(strings));
  }
  return scripts;
}

/** The hook script paths in `strings`: a Claude Code argument is the path alone; a Codex or Cursor command line holds it, perhaps quoted. */
export function scriptsIn(strings: readonly unknown[]): string[] {
  return strings.flatMap((text) => typeof text !== "string" ? [] : [...text.matchAll(/(?:^|['"\s])((?:[A-Za-z]:)?[\\/][^'"]*?storytree-hook\.mjs)/g)].map((found) => found[1]!));
}
