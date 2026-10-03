// Reads a wdio spec-reporter log and prints each test's result with its part (areas.json), then totals:
// all tests, and the tests of parts up to the one being graded (the regression set).
// Usage: node summarize.mjs <wdio log> [part]
import { readFileSync } from "node:fs";
const [log, partText] = process.argv.slice(2);
const upTo = Number(partText ?? 99);
const areas = JSON.parse(readFileSync(new URL("./areas.json", import.meta.url), "utf8")).parts;
const spec = new Map(), results = [];
for (const line of readFileSync(log, "utf8").split(/\r?\n/)) {
  const m = /^\[[^\]]*#(\d+-\d+)\]\s+(.*)$/.exec(line);
  if (!m) continue;
  const [, worker, rest] = m;
  const s = /^» .*\/([^/]+\.spec\.ts)$/.exec(rest);
  if (s) { spec.set(worker, s[1]); continue; }
  const r = /^\s*(✓|✖|-)\s+(?:\d+\)\s+)?(.*)$/.exec(rest);
  if (r && spec.has(worker)) {
    const file = spec.get(worker), title = r[2].trim();
    const map = areas[file] ?? {};
    results.push({ file, title, part: map[title] ?? map["*"], state: r[1] === "✓" ? "pass" : r[1] === "✖" ? "fail" : "skip" });
  }
}
const sessionFails = [...readFileSync(log, "utf8").matchAll(/Failed to create a session/g)].length;
for (const r of results.sort((a, b) => a.part - b.part || a.file.localeCompare(b.file))) console.log(`${r.state.padEnd(4)} part ${r.part}  ${r.file} :: ${r.title}`);
const count = (rs) => `${rs.filter((r) => r.state === "pass").length}/${rs.length}`;
console.log(`\nall: ${count(results)} passed (26 in the suite)`);
if (partText) console.log(`parts 1-${upTo}: ${count(results.filter((r) => r.part <= upTo))} passed (earlier parts are the regression set)`);
if (results.length < 26 || sessionFails) console.log(`WARNING: ${26 - results.length} tests not reported; ${sessionFails} browser sessions failed to start`);
