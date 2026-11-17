/**
 * Capability 3 · Hooks, contracts 3.50, 3.62 and 3.63. The test guard, run before each file edit. With `red|green` it is
 * the hook storytree's red and green builder agents run (`storytree-hook claude-code --test-guard red|green`, from the
 * agent files setup writes): the red agent may edit only test files and the green agent never one, so a test is seen
 * failing before code is written for it and the code is never fitted by changing the test. With `by-agent` it is the
 * hook storytree's own sessions register for the whole project (ADR-1355 D2): it reads the editing agent from the
 * hook's input (`agent_type`, which Claude Code and Codex give inside a subagent and leave out for the session itself),
 * and only the `test-writer` agent edits test code, and nothing else. It writes nothing; an input it cannot read is let through.
 */
import path from "node:path";

import { editIn, refusalAnswer } from "./edit-gate.js";

export const TEST_GUARD = "--test-guard";

/** The agent that alone writes test code under `--test-guard by-agent`, and the one that writes the rest. */
export const TEST_WRITER = "test-writer";
export const BUILDER = "builder";

/** A test file by its path inside the session's folder, in the common Python, JavaScript and Go layouts (the red and green agents' rule). */
const TEST_PATH = /(^|\/)(tests?|__tests__)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(^|\/)conftest\.py$|\.(test|spec)\.[^/]+$/;

/** Test code (3.62): a test file, or anything in a folder named exactly test, tests, __tests__, testing or fixtures. */
const TEST_CODE = /(^|\/)(tests?|__tests__|testing|fixtures)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(^|\/)conftest\.py$|\.(test|spec)\.[^/]+$/;

/** `file` as a forward-slashed path relative to `folder` when it lies inside it, else as given. */
function within(file: string, folder: string | undefined): string {
  const relative = folder === undefined ? file : path.relative(folder, file);
  const inside = folder !== undefined && relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  return (inside ? relative : file).replaceAll("\\", "/");
}

/** Whether `file` is a test file, judged by its path relative to `folder` when it lies inside it. */
export function isTestFile(file: string, folder: string): boolean {
  return TEST_PATH.test(within(file, folder));
}

/**
 * Whether `file` is test code by the one rule storytree's own fence and review slices read (3.62), judged by its path
 * relative to `folder` when given and it lies inside it; every other path is code.
 */
export function isTestCode(file: string, folder?: string): boolean {
  return TEST_CODE.test(within(file, folder));
}

/** The guard's answer to one pre-edit hook input: a refusal for the edit its mode forbids, else nothing. */
export function testGuard(harness: string, input: unknown, flags: readonly string[]): string | undefined {
  const mode = flags[flags.indexOf(TEST_GUARD) + 1];
  if (mode !== "red" && mode !== "green" && mode !== "by-agent") return undefined;
  const edit = editIn(harness, input);
  if (edit === undefined) return undefined;
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

/** The by-agent refusal (3.63): the test writer edits only test code, and every other agent and the session no test code. */
function byAgent(harness: string, input: Record<string, unknown>, edit: NonNullable<ReturnType<typeof editIn>>): string | undefined {
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
