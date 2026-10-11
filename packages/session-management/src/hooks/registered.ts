/**
 * Capability 3 · Hooks. Which hook scripts the harnesses on this machine run: read from Claude Code's settings.json and
 * Codex's and Cursor's hooks.json, so the worktree reaper never deletes the build a harness runs. Writing those files is the
 * app setup story's (ADR-0969 D3); it reads them through this.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Where each harness keeps its settings: Claude Code's config folder (~/.claude), Codex's home (~/.codex) and Cursor's (~/.cursor). */
export interface Homes {
  readonly claude?: string;
  readonly codex?: string;
  readonly cursor?: string;
}

/** The harnesses' homes on this machine: CLAUDE_CONFIG_DIR or ~/.claude, CODEX_HOME or ~/.codex, and ~/.cursor, which no variable moves. */
export function defaultHomes(env: Readonly<Record<string, string | undefined>> = process.env): Required<Homes> {
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"),
    codex: env.CODEX_HOME || path.join(homedir(), ".codex"),
    cursor: path.join(homedir(), ".cursor"),
  };
}

/** The hook scripts Claude Code's settings.json and Codex's and Cursor's hooks.json register, as paths: none from a file missing or unreadable. */
export function registeredHookScripts(homes: Homes = defaultHomes()): string[] {
  const scripts: string[] = [];
  for (const file of [homes.claude && path.join(homes.claude, "settings.json"), homes.codex && path.join(homes.codex, "hooks.json"), homes.cursor && path.join(homes.cursor, "hooks.json")]) {
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
