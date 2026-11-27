// Capability 3 · Hooks
import path from "node:path";

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
