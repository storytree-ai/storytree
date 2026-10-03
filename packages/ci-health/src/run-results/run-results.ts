/**
 * Capability 1 · Run results (ADR-0902 D1): a CI job log's test output, read into one result per test.
 *
 * A log comes as the GitHub Actions API gives it (each line timestamped) or as `gh run view --log` saves
 * it (job and step columns, then the timestamp). Either way the test runner's TAP is in it: `node --test`
 * prints `ok N - title` or `not ok N - title`, a `# SKIP` or `# TODO` directive after the title, and a
 * test's subtests indented four spaces under it, before its own line. Nothing else in the log is a result.
 */

/** One test as the run reported it: its title, the titles of the tests it sits in (outermost first), and how it went. */
export type TestResult = { name: string; suites: string[]; status: "passed" | "failed" | "skipped"; message?: string };

/** A log line's text, without the saved log's job and step columns or the runner's timestamp. */
function textOf(line: string): string {
  const columns = line.replace(/^\uFEFF/, "").split("\t");
  const last = (columns.length >= 3 ? columns.slice(2).join("\t") : line).replace(/^\uFEFF/, "");
  return last.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/, "").replace(/\r$/, "");
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
  for (const line of log.split("\n").map(textOf)) {
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
