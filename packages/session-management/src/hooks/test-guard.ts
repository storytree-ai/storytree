/**
 * Capability 3 · Hooks, contract 3.50. The test guard: the hook storytree's red and green builder agents run before
 * each file edit (`storytree-hook claude-code --test-guard red|green`, from the agent files setup writes). The red
 * agent may edit only test files and the green agent never one, so a test is seen failing before code is written for
 * it and the code is never fitted by changing the test. It writes nothing; an input it cannot read is let through.
 */
import path from "node:path";

import { editIn, refusalAnswer } from "./edit-gate.js";

export const TEST_GUARD = "--test-guard";

/** A test file by its path inside the session's folder, in the common Python, JavaScript and Go layouts. */
const TEST_PATH = /(^|\/)(tests?|__tests__)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|(^|\/)conftest\.py$|\.(test|spec)\.[^/]+$/;

/** Whether `file` is a test file, judged by its path relative to `folder` when it lies inside it. */
export function isTestFile(file: string, folder: string): boolean {
  const relative = path.relative(folder, file);
  const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  return TEST_PATH.test((inside ? relative : file).replaceAll("\\", "/"));
}

/** The guard's answer to one pre-edit hook input: a refusal for the edit its mode forbids, else nothing. */
export function testGuard(harness: string, input: unknown, flags: readonly string[]): string | undefined {
  const mode = flags[flags.indexOf(TEST_GUARD) + 1];
  if (mode !== "red" && mode !== "green") return undefined;
  const edit = editIn(harness, input);
  if (edit === undefined) return undefined;
  const forbidden = edit.files.find((file) => isTestFile(file.path, edit.folder) !== (mode === "red"));
  if (forbidden === undefined) return undefined;
  return refusalAnswer(
    harness,
    mode === "red"
      ? `The red test writer edits only tests: ${forbidden.path} is production code or config. Say what it needs instead.`
      : `The green builder never edits a test: ${forbidden.path} is a test file. If the test looks wrong, stop and say why.`,
  );
}
