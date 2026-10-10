/**
 * Capability 3 · Hooks. Which hook scripts the harnesses on this machine run: read from Claude Code's settings.json and
 * Codex's hooks.json, so the worktree reaper never deletes the build a harness runs. Writing those files is the
 * app setup story's (ADR-0969 D3); it reads them through this.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Where each harness keeps its settings: Claude Code's config folder (~/.claude) and Codex's home (~/.codex). */
export interface Homes {
  readonly claude?: string;
  readonly codex?: string;
}

/** The harnesses' homes on this machine: CLAUDE_CONFIG_DIR or ~/.claude, and CODEX_HOME or ~/.codex. */
export function defaultHomes(env: Readonly<Record<string, string | undefined>> = process.env): Required<Homes> {
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"),
    codex: env.CODEX_HOME || path.join(homedir(), ".codex"),
  };
}

/** The hook scripts Claude Code's settings.json and Codex's hooks.json register, as paths: none from a file missing or unreadable. */
export function registeredHookScripts(homes: Homes = defaultHomes()): string[] {
  const scripts: string[] = [];
  for (const file of [homes.claude && path.join(homes.claude, "settings.json"), homes.codex && path.join(homes.codex, "hooks.json")]) {
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

/** The hook script paths in `strings`: a Claude Code argument is the path alone; a Codex command line holds it, perhaps quoted. */
export function scriptsIn(strings: readonly unknown[]): string[] {
  return strings.flatMap((text) => typeof text !== "string" ? [] : [...text.matchAll(/(?:^|['"\s])((?:[A-Za-z]:)?[\\/][^'"]*?storytree-hook\.mjs)/g)].map((found) => found[1]!));
}
