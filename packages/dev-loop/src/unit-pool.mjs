// Capability 6 · Running the tests. Several units at once (increment_f465972caeaf): a full run on
// Windows CI was 21 units one after another, about 800 s of tests paced by their sum; run as a pool,
// it is paced by its slowest unit. The units already share the one Postgres safely: within a unit
// node --test runs files at once, so every test names its own databases and roles uniquely.
//
// How many at once: --jobs=<n>, else STORYTREE_TEST_JOBS, else DEFAULT_JOBS with a core left over
// for the Postgres and the browsers the tests start; one where the Postgres runs under emulation
// (Windows arm64, EMULATED below). Measured on CI (PR #1029): at 3, macOS's
// 3-core runner timed out forest's real-browser tests (run 38008232208) and a Windows 4-core runner
// timed out those and killed agent-link (now session-management) and cli at their 6 minutes (run 38009064713); each unit
// already runs its files a core less than the machine's at once.
// Which first: the slowest, so the longest unit is never the one left running alone at the end:
// by this machine's recent passes, or, for a unit with none (a fresh CI runner), by the size of its
// test files, which puts session-management, the slowest on CI, first.
import { readdirSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";

export const DEFAULT_JOBS = 2;

// There is no Windows arm64 Postgres: the x64 one runs under the OS's emulation (local-postgres,
// binaries.ts), and cores do not make up for it. Measured on a Surface Pro with 12 of them
// (increment_3f535ac2dc4e, 2026-10-11): a full run at two units at once failed 6 of 26 units in
// 16 minutes (two killed at their deadline, four on the 60 s test limit and the database's 3 s
// connect), as did every full run at two before it; one at a time took the same 16 minutes and
// none failed that way.
const EMULATED = "default: this machine's test Postgres runs under x64 emulation, which two units at once overload";

/** How many units a run tests at once, and where that number came from. */
export function testJobs({ flag, env = process.env, cpus = availableParallelism(), platform = process.platform, arch = process.arch } = {}) {
  const [value, source] = flag !== undefined ? [flag, "--jobs"] : env.STORYTREE_TEST_JOBS ? [env.STORYTREE_TEST_JOBS, "STORYTREE_TEST_JOBS"] : [undefined, "default"];
  if (value === undefined && platform === "win32" && arch === "arm64") return { jobs: 1, source: EMULATED };
  if (value === undefined) return { jobs: Math.max(1, Math.min(DEFAULT_JOBS, cpus - 1)), source };
  const jobs = Number(value);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`${source} is a whole number of units to test at once, at least 1, not ${JSON.stringify(value)}`);
  return { jobs, source };
}

/**
 * The units in the order a pool starts them: slowest first. A unit's weight is `history(unit)`, its
 * recent passing time on this machine, when it has one; units without one follow those with, by
 * the bytes of their test files. Ties keep the order given.
 */
export function slowestFirst(units, { root, history = () => undefined }) {
  const weighed = units.map((unit, index) => ({ unit, index, ms: history(unit), bytes: testBytes(root, unit) }));
  weighed.sort((a, b) => {
    if ((a.ms === undefined) !== (b.ms === undefined)) return a.ms === undefined ? 1 : -1;
    const by = a.ms !== undefined ? b.ms - a.ms : b.bytes - a.bytes;
    return by || a.index - b.index;
  });
  return weighed.map(({ unit }) => unit);
}

/** The bytes of a unit's test files: a package's `src/**\/*.test.{ts,mjs}`, or the one file a unit names. */
function testBytes(root, unit) {
  const at = path.join(root, unit);
  let total = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.test\.(ts|mjs)$/.test(entry.name)) total += statSync(file).size;
    }
  };
  try {
    if (statSync(at).isFile()) return statSync(at).size;
  } catch {
    return 0;
  }
  walk(path.join(at, "src"));
  return total;
}

/**
 * Run `run(unit)` for each unit in order, at most `jobs` at once, starting the next as soon as one
 * ends. A unit `alone(unit)` names waits until every other unit has ended, and runs with nothing
 * beside it (forest's browser proof: increment_ba747f54277d). Once `stopped()` says so, no further
 * unit starts; those running are awaited.
 */
export async function runPool(units, jobs, run, { stopped = () => false, alone = () => false } = {}) {
  const queue = units.filter((unit) => !alone(unit));
  const lane = async () => {
    while (queue.length > 0 && !stopped()) await run(queue.shift());
  };
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, lane));
  for (const unit of units.filter(alone)) if (!stopped()) await run(unit);
}
