// Capability 3 · Hooks
import path from "node:path";

import { editIn, refusalAnswer } from "./edit-gate.js";
import { shellWrites } from "./shell-writes.js";

export const TEST_GUARD = "--test-guard";

export const TEST_WRITER = "test-writer";
export const BUILDER = "builder";

const TEST_PATH = /(^|\/)(tests?|__tests__)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(^|\/)conftest\.py$|\.(test|spec)\.[^/]+$/;

const TEST_CODE = /(^|\/)(tests?|__tests__|testing|fixtures)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(^|\/)conftest\.py$|\.(test|spec)\.[^/]+$/;

function within(file: string, folder: string | undefined): string {
  const relative = folder === undefined ? file : path.relative(folder, file);
  const inside = folder !== undefined && relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  return (inside ? relative : file).replaceAll("\\", "/");
}

export function isTestFile(file: string, folder: string): boolean {
  return TEST_PATH.test(within(file, folder));
}

export function isTestCode(file: string, folder?: string): boolean {
  return TEST_CODE.test(within(file, folder));
}

export function testGuard(harness: string, input: unknown, flags: readonly string[]): string | undefined {
  const mode = flags[flags.indexOf(TEST_GUARD) + 1];
  if (mode !== "red" && mode !== "green" && mode !== "by-agent") return undefined;
  const edit = editIn(harness, input) ?? (mode === "by-agent" ? shellEditIn(harness, input) : undefined);
  if (edit === undefined) return undefined;
  const interpreter = "interpreters" in edit ? edit.interpreters[0] : undefined;
  if (interpreter !== undefined) return refusalAnswer(harness, `The test writer writes files only with Edit or Write: this ${interpreter} one-liner writes a file. Write test code with Edit or Write, and hand code to the ${BUILDER} agent.`);
  if (mode === "by-agent") return byAgent(harness, input as Record<string, unknown>, edit);
  const forbidden = edit.files.find((file) => isTestFile(file.path, edit.folder) !== (mode === "red"));
  if (forbidden === undefined) return undefined;
  return refusalAnswer(
    harness,
    mode === "red"
      ? `The red test writer edits only tests: ${forbidden.path} is production code or config. Say what it needs instead.`
      : `The green builder never edits a test: ${forbidden.path} is a test file. If the test looks wrong, stop and say why.`,
  );
}

function shellEditIn(harness: string, input: unknown): { folder: string; files: { path: string }[]; interpreters: string[] } | undefined {
  if ((harness !== "claude-code" && harness !== "codex") || typeof input !== "object" || input === null) return undefined;
  const { hook_event_name: event, agent_type: agent, cwd: folder, tool_name: tool, tool_input: toolInput } = input as Record<string, unknown>;
  if (event !== "PreToolUse" || agent !== TEST_WRITER || tool !== "Bash" || typeof folder !== "string" || folder === "" || typeof toolInput !== "object" || toolInput === null) return undefined;
  const { command } = toolInput as Record<string, unknown>;
  const { files, interpreters } = typeof command === "string" ? shellWrites(command, folder) : { files: [], interpreters: [] };
  return files.length === 0 && interpreters.length === 0 ? undefined : { folder, files: files.map((file) => ({ path: file })), interpreters };
}

function byAgent(harness: string, input: Record<string, unknown>, edit: { folder: string; files: { path: string }[] }): string | undefined {
  const agent = typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : undefined;
  const writer = agent === TEST_WRITER;
  const forbidden = edit.files.find((file) => isTestCode(file.path, edit.folder) !== writer);
  if (forbidden === undefined) return undefined;
  return refusalAnswer(
    harness,
    writer
      ? `The test writer edits only test code: ${forbidden.path} is code. Hand it to the ${BUILDER} agent: say what the code must do, and stop.`
      : `Only the ${TEST_WRITER} agent edits test code: ${forbidden.path} is test code, and ${agent === undefined ? "this session" : `the ${agent} agent`} may not edit it. Hand it to the ${TEST_WRITER} agent with what is wrong with the test, and stop; never edit it by another route.`,
  );
}
