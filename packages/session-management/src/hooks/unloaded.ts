// Capability 3 · Hooks
import { patchFiles } from "./patch-files.js";
import { isTestCode } from "./test-paths.js";

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]);

export function unloadedRefusal(argv: readonly string[], input: string, error: unknown): string | undefined {
  if (!argv.includes("--test-guard")) return undefined;
  const call = parsed(input);
  if (call === undefined) return undefined;
  const { tool_name: tool, agent_type: agent } = call;
  if (typeof tool !== "string" || !(EDITS.has(tool) || (tool === "Bash" && agent === "test-writer"))) return undefined;
  if (argv[argv.indexOf("--test-guard") + 1] === "by-agent" && letThrough(argv[0], call)) return undefined;
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

function letThrough(harness: string | undefined, call: Record<string, unknown>): boolean {
  const { cwd: folder, tool_name: tool, agent_type: agent } = call;
  const files = editedFiles(harness, tool, call.tool_input);
  if (typeof folder !== "string" || folder === "" || files.length === 0) return false;
  const writer = agent === "test-writer";
  return files.every((file) => isTestCode(file, folder) === writer);
}

function editedFiles(harness: string | undefined, tool: unknown, toolInput: unknown): string[] {
  if (typeof toolInput !== "object" || toolInput === null) return [];
  const { file_path: file, notebook_path: notebook, command } = toolInput as Record<string, unknown>;
  const named = harness === "claude-code" && (tool === "Edit" || tool === "Write" || tool === "MultiEdit") ? file : harness === "claude-code" && tool === "NotebookEdit" ? notebook : undefined;
  if (typeof named === "string" && named !== "") return [named];
  return harness === "codex" && tool === "apply_patch" && typeof command === "string" ? patchFiles(command) : [];
}

function parsed(input: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(input);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
