// Capability 3 · Hooks

export const AFTER_TOOL = "--after-tool";
export const BACKGROUND = "--background";
export const HANDED = "--handed";

export function handsOffAtOnce(harness: string, flags: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (harness !== "claude-code" || flags.includes(HANDED)) return false;
  return flags.includes(BACKGROUND) || (flags.includes(AFTER_TOOL) && (env.CLAUDE_CODE_ENTRYPOINT ?? "").startsWith("sdk"));
}

let deaf = false;

export function deafIfHandingOffAtOnce(): boolean {
  const [harness = "", ...flags] = process.argv.slice(2);
  if (!handsOffAtOnce(harness, flags, process.env)) return false;
  if (!deaf) process.on("SIGTERM", () => undefined);
  deaf = true;
  return true;
}
