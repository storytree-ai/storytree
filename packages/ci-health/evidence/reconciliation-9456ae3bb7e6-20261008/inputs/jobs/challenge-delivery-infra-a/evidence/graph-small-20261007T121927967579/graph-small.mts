import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Session } from 'node:inspector';
import { packageProblems } from '/repo/packages/guardrails/src/package-rule/package-rule.ts';

// In-process V8 coverage counts calls in the imported, unmodified implementation.
// At most six manifests and 63 recursive calls per case; no stress or timing test.
const session = new Session();
session.connect();
const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => {
  session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
});
await post('Profiler.enable');
await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
const cases = [
  { name: 'chain4', graph: [[1], [2], [3], []], calls: 10, problems: 0 },
  { name: 'diamond4', graph: [[1, 2], [3], [3], []], calls: 10, problems: 0 },
  ...[4, 5, 6].map(n => ({ name: `dag${n}`, graph: Array.from({ length: n }, (_, i) => Array.from({ length: n - i - 1 }, (_, j) => i + j + 1)), calls: 2 ** n - 1, problems: 0 })),
  { name: 'cycle2', graph: [[1], [0]], calls: 6, problems: 1 },
];
try {
  for (const item of cases) {
    const root = mkdtempSync('/work/graph-');
    try {
      for (const [i, targets] of item.graph.entries()) {
        const folder = path.join(root, 'packages', `p${i}`);
        mkdirSync(folder, { recursive: true });
        writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: `p${i}`, dependencies: Object.fromEntries(targets.map(j => [`p${j}`, 'workspace:*'])) }));
      }
      await post('Profiler.takePreciseCoverage');
      const problems = packageProblems(root);
      const result = await post('Profiler.takePreciseCoverage');
      const source = result.result.find((s: any) => s.url.endsWith('/packages/guardrails/src/package-rule/package-rule.ts'));
      assert.ok(source, 'real package-rule module must appear in coverage');
      const visit = source.functions.find((f: any) => f.functionName === 'visit');
      assert.ok(visit, 'real nested visit must appear in coverage');
      const calls = visit.ranges[0].count;
      assert.equal(calls, item.calls);
      assert.equal(problems.length, item.problems);
      console.log(JSON.stringify({ case: item.name, vertices: item.graph.length, edges: item.graph.flat().length, visitCalls: calls, problems }));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
} finally {
  await post('Profiler.stopPreciseCoverage');
  session.disconnect();
}
