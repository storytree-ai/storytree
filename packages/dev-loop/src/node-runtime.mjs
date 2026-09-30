// Which Node.js may run storytree's tests on this machine.
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

function shipsTheFix(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return false; // not a version this can judge: refused, not waved through
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major > LAST_LINE_BRANCHED_WITHOUT_IT) return true;
  const first = FIXED_FROM.get(major);
  if (first === undefined) return false;
  const [fixedMinor, fixedPatch] = first;
  return minor > fixedMinor || (minor === fixedMinor && patch >= fixedPatch);
}
