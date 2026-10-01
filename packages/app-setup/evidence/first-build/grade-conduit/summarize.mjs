// Turns a Playwright JSON report into the grader's per-test table.
//
//   node summarize.mjs <report.json> [--summary-out summary.json]
//                      [--failed-out failed.txt] [--confirm <confirm-report.json>] [--quiet]
//
// Prints one row per test: STATUS, spec file, test title, first error line
// (or the skip reason). STATUS is
//   PASS   passed first time
//   FLAKY  failed, then passed on a retry or on the confirmation re-run
//   FAIL   failed every attempt (including the confirmation re-run, if one was made)
//   SKIP   skipped by the suite
// then a per-file count table and a total line.
// --failed-out writes the Playwright locations (e2e/<file>:<line>) of FAIL rows, one per line.
// --confirm merges a later re-run of the failed tests: a FAIL that passed there becomes FLAKY.
// Exit code: 0 no test failed (FLAKY and SKIP do not fail), 1 any test failed,
//            2 the report is missing, empty or carries a top-level error.

import fs from 'node:fs';
import path from 'node:path';

const [reportPath, ...rest] = process.argv.slice(2);
const opt = name => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
const summaryOut = opt('--summary-out');
const failedOut = opt('--failed-out');
const confirmPath = opt('--confirm');
const quiet = rest.includes('--quiet');
if (quiet) console.log = () => {};

const stripAnsi = s => String(s ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const oneLine = (s, n = 170) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function firstErrorLine(result) {
  const errs = result?.errors?.length ? result.errors : result?.error ? [result.error] : [];
  if (!errs.length) return '';
  const lines = stripAnsi(errs[0].message || errs[0].value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  let line = lines[0];
  // A bare "expect(locator).toBeVisible() failed" says little on its own: add the locator.
  const loc = lines.find(l => /^Locator:/.test(l));
  if (loc && !line.includes(loc.replace(/^Locator:\s*/, ''))) line += ` [${loc}]`;
  return oneLine(line);
}

function load(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { _error: e.message };
  }
}

function collect(report) {
  const rows = [];
  function walk(suite, titlePath) {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || [];
        const last = results[results.length - 1];
        let status;
        if (t.status === 'skipped') status = 'SKIP';
        else if (t.status === 'flaky') status = 'FLAKY';
        else if (t.status === 'expected') status = 'PASS';
        else status = 'FAIL';
        let detail = '';
        if (status === 'FAIL') detail = firstErrorLine(last);
        else if (status === 'FLAKY') detail = 'passed on retry; first attempt: ' + firstErrorLine(results.find(r => r.status !== 'passed'));
        else if (status === 'SKIP') {
          const a = (t.annotations || []).concat(last?.annotations || []).find(x => x.type === 'skip' || x.type === 'fixme');
          detail = a?.description ? 'skip: ' + oneLine(a.description) : '';
        }
        const file = path.basename(spec.file || suite.file || '');
        rows.push({
          status,
          file,
          line: spec.line,
          location: `e2e/${file}:${spec.line}`,
          title: [...titlePath, spec.title].filter(Boolean).join(' › '),
          attempts: results.length,
          detail,
        });
      }
    }
    for (const s of suite.suites || []) walk(s, [...titlePath, s.title]);
  }
  for (const top of report.suites || []) walk(top, []);
  return rows;
}

const report = load(reportPath);
if (report._error) {
  console.error(`grade-conduit: no readable Playwright report at ${reportPath} (${report._error})`);
  process.exit(2);
}
const rows = collect(report);
const runErrors = (report.errors || []).map(e => oneLine(stripAnsi(e.message || '').split(/\r?\n/)[0]));

if (confirmPath) {
  const confirm = load(confirmPath);
  if (confirm._error) {
    console.log(`grade-conduit: confirmation re-run left no report (${confirm._error}); its FAILs stand`);
  } else {
    const again = new Map(collect(confirm).map(r => [r.file + '|' + r.title, r]));
    for (const r of rows) {
      if (r.status !== 'FAIL') continue;
      const c = again.get(r.file + '|' + r.title);
      if (!c) continue;
      if (c.status === 'PASS' || c.status === 'FLAKY') {
        r.status = 'FLAKY';
        r.detail = `failed ${r.attempts}x, passed on the confirmation re-run; first error: ${r.detail}`;
      } else if (c.status === 'FAIL') {
        r.detail = `${r.detail}  (failed again on the confirmation re-run)`;
      }
    }
  }
}

// Per-test table
const W = Math.max(9, ...rows.map(r => r.file.length));
console.log('');
console.log(`${'STATUS'.padEnd(6)} ${'SPEC FILE'.padEnd(W)}  TEST  |  FIRST ERROR LINE / SKIP REASON`);
console.log('-'.repeat(110));
for (const r of rows) {
  console.log(`${r.status.padEnd(6)} ${r.file.padEnd(W)}  ${oneLine(r.title, 95)}${r.detail ? '  |  ' + r.detail : ''}`);
}

// Per-file counts
const files = {};
for (const r of rows) {
  files[r.file] ??= { PASS: 0, FLAKY: 0, FAIL: 0, SKIP: 0 };
  files[r.file][r.status]++;
}
console.log('');
console.log(`${'SPEC FILE'.padEnd(W)}  PASS  FLAKY  FAIL  SKIP`);
for (const [f, c] of Object.entries(files)) {
  console.log(`${f.padEnd(W)}  ${String(c.PASS).padStart(4)}  ${String(c.FLAKY).padStart(5)}  ${String(c.FAIL).padStart(4)}  ${String(c.SKIP).padStart(4)}`);
}
const total = { PASS: 0, FLAKY: 0, FAIL: 0, SKIP: 0 };
for (const r of rows) total[r.status]++;
console.log('');
console.log(`TOTAL ${rows.length} tests: ${total.PASS} pass, ${total.FLAKY} flaky (passed on a retry or re-run), ${total.FAIL} fail, ${total.SKIP} skip`);
for (const e of runErrors) console.log(`RUN ERROR: ${e}`);

if (summaryOut) fs.writeFileSync(summaryOut, JSON.stringify({ total, files, rows, runErrors }, null, 2));
if (failedOut) {
  const locs = [...new Set(rows.filter(r => r.status === 'FAIL').map(r => r.location))];
  fs.writeFileSync(failedOut, locs.join('\n'));
}

if (!rows.length || runErrors.length) process.exit(2);
process.exit(total.FAIL ? 1 : 0);
