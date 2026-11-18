// Capability 1 · Run results.

export type TestResult = { name: string; suites: string[]; status: "passed" | "failed" | "skipped"; message?: string; platform?: string; file?: string; line?: number };

const PYTEST_STATUS: Record<string, TestResult["status"]> = { PASSED: "passed", XPASS: "passed", FAILED: "failed", ERROR: "failed", XFAIL: "failed" };

function textOf(line: string): string {
  const columns = line.replace(/^\uFEFF/, "").split("\t");
  const last = (columns.length >= 3 ? columns.slice(2).join("\t") : line).replace(/^\uFEFF/, "");
  return last.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/, "").replace(/\r$/, "");
}

function unescape(title: string): string {
  return title.replace(/\\([#\\])/g, "$1");
}

export function parseTestLog(log: string): TestResult[] {
  const results: TestResult[] = [];
  const open: string[] = [];
  const suites: string[] = [];
  let recap = false;
  for (const line of log.split("\n").map(textOf)) {
    const repeated = recap;
    recap = /^test at \S/.test(line);
    const pytest = /^(PASSED|XPASS|FAILED|ERROR|XFAIL) (\S+?\.py)::(?=.)/.exec(line);
    if (pytest !== null) {
      const rest = line.slice(pytest[0].length);
      const dash = rest.indexOf(" - ", 1);
      const ids = (dash < 0 ? rest : rest.slice(0, dash)).trim().split("::");
      const result: TestResult = { name: ids.at(-1)!, suites: ids.slice(0, -1), status: PYTEST_STATUS[pytest[1]!]!, file: pytest[2]!.replaceAll("\\", "/") };
      const message = dash < 0 ? "" : rest.slice(dash + 3).trim();
      if (pytest[1] === "XFAIL") result.message = `expected to fail (xfail)${message === "" ? "" : `: ${message}`}`;
      else if (message !== "") result.message = message;
      results.push(result);
      continue;
    }
    const skip = /^SKIPPED \[\d+\] (\S+?\.py):(\d+):/.exec(line);
    if (skip !== null) {
      const result: TestResult = { name: "", suites: [], status: "skipped", file: skip[1]!.replaceAll("\\", "/"), line: Number(skip[2]) };
      const message = line.slice(skip[0].length).trim();
      if (message) result.message = message;
      results.push(result);
      continue;
    }
    const suite = /^((?: {2})*)▶ (.*)$/.exec(line);
    if (suite !== null) {
      const depth = suite[1]!.length / 2;
      suites.length = depth;
      suites[depth] = suite[2]!.trim();
      continue;
    }
    const spec = /^((?: {2})*)(✔|✖|﹣) (.*?) \(\d+(?:\.\d+)?ms\)(?:( # )|$)/.exec(line);
    if (spec !== null) {
      if (repeated) continue;
      const depth = spec[1]!.length / 2;
      const directive = spec[4] === undefined ? undefined : line.slice(spec[0].length).trim();
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
    const point = /^((?: {4})*)(not ok|ok) \d+(?= - | # (?:SKIP|TODO)\b|$)/i.exec(line);
    if (point === null) continue;
    const depth = point[1]!.length / 4;
    const rest = line.slice(point[0].length).replace(/^ - /, "");
    const marked = / # (SKIP|TODO)\b ?/i.exec(rest);
    const name = unescape(rest.slice(0, marked?.index ?? rest.length)).trim();
    const directive = marked?.[1]!.toUpperCase();
    const result: TestResult = { name, suites: open.slice(0, depth), status: directive !== undefined ? "skipped" : point[2]!.toLowerCase() === "ok" ? "passed" : "failed" };
    const message = marked === null ? "" : rest.slice(marked.index + marked[0].length);
    if (directive !== undefined && message) result.message = message.trim();
    results.push(result);
    open.length = depth;
  }
  return results;
}

export function commitOfLog(log: string): string | undefined {
  const lines = log.split("\n").map(textOf);
  const at = lines.findIndex((line) => /git log -1 --format=%H\s*$/.test(line));
  const commit = at < 0 ? undefined : lines[at + 1]?.trim();
  return commit !== undefined && /^[0-9a-f]{40}$/.test(commit) ? commit : undefined;
}

export function scopeOfLog(log: string): string[] | "everything" | undefined {
  for (const line of log.split("\n").map(textOf)) {
    const scope = /^scope: ([\w-]+)(?: — (.*?) — )?/.exec(line);
    if (scope === null) continue;
    if (scope[1] === "full" || scope[2] === undefined) return "everything";
    return scope[2] === "nothing" ? [] : scope[2]!.split(", ").map((folder) => folder.trim());
  }
  return undefined;
}
