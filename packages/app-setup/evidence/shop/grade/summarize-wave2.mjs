// Reads wave 2's Playwright JSON report and prints each test with its part (the number its title starts with),
// then totals for all of wave 2 and for parts 5 up to the one being graded. These criteria are ours (wave2/README.md).
// Usage: node summarize-wave2.mjs <results.json> [part]
import { readFileSync } from "node:fs";
const [file, partText] = process.argv.slice(2);
const upTo = Number(partText ?? 99);
const report = JSON.parse(readFileSync(file, "utf8"));
const results = [];
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    const status = spec.tests?.[0]?.results?.at(-1)?.status ?? "skipped";
    results.push({ title: spec.title, part: Number(/^(\d+)\./.exec(spec.title)?.[1]), state: status === "passed" ? "pass" : status === "skipped" ? "skip" : "fail", error: spec.tests?.[0]?.results?.at(-1)?.error?.message?.replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0] });
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);
for (const r of results.sort((a, b) => a.part - b.part || a.title.localeCompare(b.title))) console.log(`${r.state.padEnd(4)} ${r.title}${r.state === "fail" && r.error ? `  -- ${r.error.slice(0, 160)}` : ""}`);
const count = (rs) => `${rs.filter((r) => r.state === "pass").length}/${rs.length}`;
console.log(`\nwave 2 (our suite): ${count(results)} passed`);
console.log(`parts 5-${upTo}: ${count(results.filter((r) => r.part <= upTo))} passed (ours; earlier wave 2 parts are regressions)`);
