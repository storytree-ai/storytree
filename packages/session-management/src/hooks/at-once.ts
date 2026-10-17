/**
 * Capability 3 · Hooks. Whether a hook hands its input to a copy of itself at once, and the deafness to SIGTERM such a
 * hook needs from its first statement. It imports nothing, so an entry point can import it first and call
 * deafIfHandingOffAtOnce() before the rest of the command loads: Claude Code stops a `claude -p` session's hooks by
 * SIGTERM some 60 ms in, and on a loaded machine the hook's imports alone can take longer than that.
 */

/** The flag of a command hook registered beside a tool server's handler for the same event: it stands down when the tool recorded it. */
export const AFTER_TOOL = "--after-tool";
/** The flag that makes a hook hand its writing to the background instead of doing it. */
export const BACKGROUND = "--background";
/** The flag a hook's copy is started with, so a handed-on hook is read apart from the one the harness waits for. */
export const HANDED = "--handed";

/**
 * Whether Claude Code's hook hands its input to a copy of itself at once, deciding nothing first: its end hook, which
 * Claude Code cuts short at 1.5 s, and in a `claude -p` session (CLAUDE_CODE_ENTRYPOINT "sdk-…") every hook run after
 * a tool, which Claude Code stops by SIGTERM when the turn ends and its process exits, some 60 ms into its end-of-turn
 * hook. The copy, detached, outlives it and waits for the mod's note as the hook would have.
 */
export function handsOffAtOnce(harness: string, flags: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (harness !== "claude-code" || flags.includes(HANDED)) return false;
  return flags.includes(BACKGROUND) || (flags.includes(AFTER_TOOL) && (env.CLAUDE_CODE_ENTRYPOINT ?? "").startsWith("sdk"));
}

let deaf = false;

/**
 * For this process's hook (its harness and flags in argv): if it hands off at once, ignore SIGTERM from now on, since
 * it is not done until its copy has the input. Says whether it does; a second call adds no second handler.
 */
export function deafIfHandingOffAtOnce(): boolean {
  const [harness = "", ...flags] = process.argv.slice(2);
  if (!handsOffAtOnce(harness, flags, process.env)) return false;
  if (!deaf) process.on("SIGTERM", () => undefined);
  deaf = true;
  return true;
}
