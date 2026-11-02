// Capability 4 · Running the tests. Which Node.js may run storytree's tests on this machine.
//
// On Windows, libuv (Node.js's I/O layer) asks RtlGetVersion for the Windows version on every TCP
// connect, and hands it an OSVERSIONINFOW whose size field it never set. When the stack garbage
// there happens to equal the size of the larger OSVERSIONINFOEXW, RtlGetVersion fills that one in,
// writing 8 bytes past the end over the stack cookie, and Windows ends the process on the spot:
// exit code 3221226505 (0xC0000409), nothing printed. In `pnpm test` that is a test file whose
// process dies at its first connection to the test Postgres, before any of its tests reports.
// libuv fixed it in commit aabb7651 ("win: properly initialize OSVERSIONINFOW", libuv#5107), and
// Node.js ships the fix from 24.16.0 in the 24 line and from 26.1.0; the older lines and every
// 25.x ship without it.
//
// Below the floor the tested project's package.json names (engines.node), the tests can hang file by
// file until each unit's deadline: a cloud container whose path put Node.js 22 first timed every file
// out at 180 s (friction_dae7689d182a). That Node.js is refused at the start, on every platform.
import { readFileSync } from "node:fs";
import path from "node:path";

/** The first release of each Node.js line that ships the fix, as [minor, patch]. */
const FIXED_FROM = new Map([
  [24, [16, 0]],
  [26, [1, 0]],
]);

/** Every line after this one was branched from a Node.js that already had the fix. */
const LAST_LINE_BRANCHED_WITHOUT_IT = 26;

/**
 * Why Node.js `version` cannot run the tests on `platform`, as a message saying what to install
 * instead; undefined when it can. By default, the Node.js and the platform this runs on.
 */
export function runtimeRefusal(version = process.version, platform = process.platform) {
  if (platform !== "win32" || shipsTheFix(version)) return undefined;
  return (
    `Node.js ${version} cannot run storytree's tests on Windows: its libuv can end the process on a TCP ` +
    "connect (libuv#5107), so now and then a test file dies at its first connection to the test Postgres, " +
    "with exit code 3221226505 (0xC0000409) and nothing printed. Node.js 24.16.0 and later 24.x, and 26.1.0 and " +
    "later, carry the fix: install one (`winget upgrade OpenJS.NodeJS.LTS`), then run the tests again."
  );
}

/**
 * Why Node.js `version` is below the floor `root`'s package.json names (engines.node, as `>=x.y.z`),
 * as a message naming both; undefined when it is not, or when there is no such floor to read.
 */
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
  if (parsed === undefined) return false; // not a version this can judge: refused, not waved through
  const [major, minor, patch] = parsed;
  if (major > LAST_LINE_BRANCHED_WITHOUT_IT) return true;
  const first = FIXED_FROM.get(major);
  if (first === undefined) return false;
  const [fixedMinor, fixedPatch] = first;
  return minor > fixedMinor || (minor === fixedMinor && patch >= fixedPatch);
}
