/**
 * Capability 1 · Run results (ADR-0902 D1): a CI job log's test output, read into one result per test.
 *
 * A log comes as the GitHub Actions API gives it (each line timestamped) or as `gh run view --log` saves
 * it (job and step columns, then the timestamp). Either way the test runner's TAP is in it: `node --test`
 * prints `ok N - title` or `not ok N - title`, a `# SKIP` or `# TODO` directive after the title, and a
 * test's subtests indented four spaces under it, before its own line. From Node 23 on, `node --test` prints its
 * spec format instead, in CI too: `✔ title (12ms)` passed, `✖` failed, `﹣ … # reason` skipped, `# TODO` after the
 * time, a `▶ title` opening a suite whose tests sit two spaces in, and a failing-tests recap at the end that repeats
 * each failure after a `test at <file>` line. Nothing else in the log is a result.
 */

/**
 * One test as the run reported it: its title, the titles of the tests it sits in (outermost first), and how it went;
 * and the platform of the job that ran it (`win32`, `darwin`, `linux`), where the job named one.
 */
export type TestResult = { name: string; suites: string[]; status: "passed" | "failed" | "skipped"; message?: string; platform?: string };

/** A log line's text, without the saved log's job and step columns or the runner's timestamp. */
function textOf(line: string): string {
  const columns = line.replace(/^\uFEFF/, "").split("\t");
  const last = (columns.length >= 3 ? columns.slice(2).join("\t") : line).replace(/^\uFEFF/, "");
  return last.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/, "").replace(/\r$/, "");
}

/** A TAP title's text: TAP escapes a `#` and a backslash in it. */
function unescape(title: string): string {
  return title.replace(/\\([#\\])/g, "$1");
}

/** The results a job log's TAP reports, in the order it reports them. */
export function parseTestLog(log: string): TestResult[] {
  const results: TestResult[] = [];
  // The open `# Subtest:` names by depth: a result at depth d sits in the subtests open above it.
  const open: string[] = [];
  // The spec format's open `▶` suites by depth, and whether the line before was the recap's `test at <file>`.
  const suites: string[] = [];
  let recap = false;
  for (const line of log.split("\n").map(textOf)) {
    const repeated = recap;
    recap = /^test at \S/.test(line);
    const suite = /^((?: {2})*)▶ (.*)$/.exec(line);
    if (suite !== null) {
      const depth = suite[1]!.length / 2;
      suites.length = depth;
      suites[depth] = suite[2]!.trim();
      continue;
    }
    const spec = /^((?: {2})*)(✔|✖|﹣) (.*?) \(\d+(?:\.\d+)?ms\)(?: # (.*))?$/.exec(line);
    if (spec !== null) {
      if (repeated) continue;
      const depth = spec[1]!.length / 2;
      const directive = spec[4]?.trim();
      const skipped = spec[2] === "﹣" || directive === "TODO";
      const result: TestResult = { name: spec[3]!.trim(), suites: suites.slice(0, depth), status: skipped ? "skipped" : spec[2] === "✔" ? "passed" : "failed" };
      if (spec[2] === "﹣" && directive && directive !== "SKIP") result.message = directive;
      results.push(result);
      suites.length = depth;
      continue;
    }
    const subtest = /^((?: {4})*)# Subtest: (.*)$/.exec(line);
    if (subtest !== null) {
      const depth = subtest[1]!.length / 4;
      open.length = depth;
      open[depth] = unescape(subtest[2]!);
      continue;
    }
    const point = /^((?: {4})*)(not ok|ok) \d+(?: - (.*?))?(?: # (SKIP|TODO)\b ?(.*))?$/i.exec(line);
    if (point === null) continue;
    const depth = point[1]!.length / 4;
    const name = unescape(point[3] ?? "").trim();
    const directive = point[4]?.toUpperCase();
    const result: TestResult = { name, suites: open.slice(0, depth), status: directive !== undefined ? "skipped" : point[2]!.toLowerCase() === "ok" ? "passed" : "failed" };
    if (directive !== undefined && point[5]) result.message = point[5].trim();
    results.push(result);
    open.length = depth;
  }
  return results;
}

/** The commit a run tested, as its checkout step printed it (`git log -1 --format=%H`), or undefined. */
export function commitOfLog(log: string): string | undefined {
  const lines = log.split("\n").map(textOf);
  const at = lines.findIndex((line) => /git log -1 --format=%H\s*$/.test(line));
  const commit = at < 0 ? undefined : lines[at + 1]?.trim();
  return commit !== undefined && /^[0-9a-f]{40}$/.test(commit) ? commit : undefined;
}
