// Capability 4 · Running the tests
import { readFileSync } from "node:fs";
import path from "node:path";

const FIXED_FROM = new Map([
  [24, [16, 0]],
  [26, [1, 0]],
]);

const LAST_LINE_BRANCHED_WITHOUT_IT = 26;

export function runtimeRefusal(version = process.version, platform = process.platform) {
  if (platform !== "win32" || shipsTheFix(version)) return undefined;
  return (
    `Node.js ${version} cannot run storytree's tests on Windows: its libuv can end the process on a TCP ` +
    "connect (libuv#5107), so now and then a test file dies at its first connection to the test Postgres, " +
    "with exit code 3221226505 (0xC0000409) and nothing printed. Node.js 24.16.0 and later 24.x, and 26.1.0 and " +
    "later, carry the fix: install the version this project pins in .node-version " +
    "(`winget install --id OpenJS.NodeJS.LTS --exact --version <it> --force`), then run the tests again."
  );
}

export function floorRefusal(version, root) {
  let range;
  try {
    range = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).engines?.node;
  } catch {
    return undefined;
  }
  const floor = typeof range === "string" ? /^>=\s*v?(\d+\.\d+\.\d+)$/.exec(range.trim()) : null;
  const found = parseVersion(version);
  if (floor === null || found === undefined || compare(found, parseVersion(floor[1])) >= 0) return undefined;
  return (
    `Node.js ${version} is below this project's floor, node ${range.trim()} (package.json's engines.node), and under ` +
    `it the tests can hang until each file's deadline. Put a Node.js ${floor[1]} or later first on the path ` +
    "(`node -v` says which one runs), then run the tests again."
  );
}

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match === null ? undefined : match.slice(1).map(Number);
}

function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function shipsTheFix(version) {
  const parsed = parseVersion(version);
  if (parsed === undefined) return false;
  const [major, minor, patch] = parsed;
  if (major > LAST_LINE_BRANCHED_WITHOUT_IT) return true;
  const first = FIXED_FROM.get(major);
  if (first === undefined) return false;
  const [fixedMinor, fixedPatch] = first;
  return minor > fixedMinor || (minor === fixedMinor && patch >= fixedPatch);
}
