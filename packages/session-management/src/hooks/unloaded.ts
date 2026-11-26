// Capability 3 · Hooks

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]);

export function unloadedRefusal(argv: readonly string[], input: string, error: unknown): string | undefined {
  if (!argv.includes("--test-guard")) return undefined;
  const call = parsed(input);
  if (call === undefined) return undefined;
  const { tool_name: tool, agent_type: agent } = call;
  if (typeof tool !== "string" || !(EDITS.has(tool) || (tool === "Bash" && agent === "test-writer"))) return undefined;
  const failed = error instanceof Error ? error.message : String(error);
  return `The test guard could not load, so it refuses this edit until it loads again: ${failed}`;
}

export async function refuseUnloaded(error: unknown): Promise<never> {
  const argv = process.argv.slice(2);
  if (!argv.includes("--test-guard")) throw error;
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const reason = unloadedRefusal(argv, input, error);
  if (reason === undefined) throw error;
  process.stderr.write(`${reason}\n`, () => process.exit(2));
  return new Promise<never>(() => undefined);
}

function parsed(input: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(input);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
