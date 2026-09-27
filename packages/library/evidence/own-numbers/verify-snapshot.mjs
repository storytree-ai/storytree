// Read-only source snapshot; every command below runs in a home this script creates and removes.
// Run from the repository root: node --import tsx packages/library/evidence/own-numbers/verify-snapshot.mjs <snapshot.json>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { start } from '@storytree/local-postgres';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2]);
const input = JSON.parse(readFileSync(source, 'utf8'));
const home = mkdtempSync(path.join(tmpdir(), 'storytree-own-numbers-'));
const env = { ...process.env, STORYTREE_HOME: home, CODEX_THREAD_ID: '', CLAUDE_CODE_SESSION_ID: '' };
let server;
let connection;
function run(name, args, expected = 0, script = 'packages/cli/src/bins/storytree.ts') {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { env, encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = `$ node --import tsx ${script} ${args.join(' ')}\n${result.stdout}${result.stderr}\nexit: ${result.status}\n`;
  writeFileSync(path.join(evidence, name), output);
  assert.equal(result.status, expected, output);
  return result.stdout;
}
try {
  run('restore.txt', [source, '--project', 'storytree'], 0, 'scripts/restore-library.mjs');
  server = await start({ dataDir: path.join(home, 'pgdata'), owner: 'own-numbers snapshot proof' });
  connection = await connect({ url: server.url });
  let library = await connection.openProject('storytree');
  const before = await connection.snapshot('storytree');
  const beforeHistory = await library.history();
  const decisions = await library.list('decision');
  const founding = decisions.filter((record) => !record.fields.text.split(/\r?\n/).some((line) => /^[ \t]*Full record:/.test(line)));
  assert.equal(founding.length, 53);
  run('floor-unset.txt', ['adr', 'renumber', '--founding-books'], 1);
  run('floor-dry-run.txt', ['adr', 'set-floor', '--number', '662', '--dry-run']);
  assert.deepEqual(await library.history(), beforeHistory, 'preview does not write');
  run('floor-apply.txt', ['adr', 'set-floor', '--number', '662', '--apply']);
  const switched = await library.history();
  const dry = run('founding-dry-run.txt', ['adr', 'renumber', '--founding-books', '--dry-run']);
  assert.match(dry, /53 ready; 0 refused/);
  assert.deepEqual(await library.history(), switched);
  const plan = await library.numberFoundingDecisions();
  const applied = run('founding-apply.txt', ['adr', 'renumber', '--founding-books', '--apply']);
  assert.match(applied, /53 renumbered; 0 refused/);
  const after = await connection.snapshot('storytree');
  assert.deepEqual(after.history.slice(0, before.history.length), before.history, 'every original event survives unchanged');
  assert.equal(after.history.length, before.history.length + 54);
  assert.equal(after.records.length, before.records.length + 1, 'only the setting adds a record');
  const moved = new Map(plan.map((row) => [row.id, row.number]));
  for (const record of decisions) {
    const next = await library.get(record.id);
    assert.deepEqual(next.fields, moved.has(record.id) ? { ...record.fields, number: moved.get(record.id) } : record.fields);
    if (moved.has(record.id)) {
      const events = await library.history({ id: record.id });
      assert.equal(events.at(-1).record.fields.number, moved.get(record.id));
      assert.equal(events.at(-2).record.fields.number, record.fields.number);
    }
  }
  for (const record of before.records.filter((record) => record.type !== 'decision')) {
    assert.deepEqual(after.records.find((next) => next.id === record.id), record, 'unrelated record unchanged');
  }
  const afterHistory = await library.history();
  run('floor-repeat.txt', ['adr', 'set-floor', '--number', '662', '--apply'], 1);
  run('floor-lower.txt', ['adr', 'set-floor', '--number', '661', '--apply'], 1);
  assert.deepEqual(await library.history(), afterHistory);
  const next = Math.max(662, ...after.history.map((event) => typeof event.record.fields.number === 'number' ? event.record.fields.number : 0)) + 1;
  const created = run('new-decision.txt', ['adr', 'new', '--title', 'Throwaway numbering proof', '--text', 'Only in the isolated snapshot copy.', '--status', 'accepted']);
  assert.match(created, new RegExp(`ADR-${String(next).padStart(4, '0')}`));
  const completed = await library.history();
  assert.match(run('founding-repeat.txt', ['adr', 'renumber', '--founding-books', '--apply']), /0 renumbered; 0 refused/);
  assert.deepEqual(await library.history(), completed);

  // A real restart must retain the setting. Snapshot restore must retain it as well.
  const saved = await connection.snapshot('storytree');
  await connection.close();
  await server.stop();
  server = await start({ dataDir: path.join(home, 'pgdata'), owner: 'own-numbers snapshot proof' });
  connection = await connect({ url: server.url });
  library = await connection.openProject('storytree');
  await assert.rejects(library.setDecisionNumberFloor(700, { apply: true }), /already/);
  assert.deepEqual(await library.numberFoundingDecisions(), []);
  await connection.restore('snapshot-roundtrip', saved);
  const roundtrip = await connection.snapshot('snapshot-roundtrip');
  assert.deepEqual(roundtrip.records, saved.records);
  assert.deepEqual(roundtrip.history, saved.history);
  const summary = [
    `Source: ${source}`,
    `Source snapshot: ${input.records.length} records; ${input.history.length} events.`,
    `Restored before switch: ${before.records.length} records; ${before.history.length} events; ${decisions.length} decisions.`,
    `${founding.length} founding decisions; ${decisions.length - founding.length} Full record decisions.`,
    `Dry run: ${plan.length} ready, 0 refused; no writes.`,
    `Applied: ${plan.length} renumbered, 0 refused; ${Math.min(...moved.values())} through ${Math.max(...moved.values())}.`,
    `After move: ${after.records.length} records; ${after.history.length} events (+1 setting, +53 repair events).`,
    `Next automatic decision: ADR-${String(next).padStart(4, '0')}.`,
    'Repeated and lower floor writes refused; no events appended.',
    'Repeat founding apply: 0 changed, 0 refused; post-switch decision untouched.',
    'All original history, decision IDs and other fields preserved (normal legacy schema upgrade on write).',
    'Every other record unchanged; all 29 Full record decisions unchanged.',
    'Floor and completed moves survived server restart and snapshot roundtrip.',
    'Real library untouched. Temporary server stopped and home removed in finally.',
  ].join('\n') + '\n';
  writeFileSync(path.join(evidence, 'snapshot-verification.txt'), summary);
  console.log(summary);
} finally {
  await connection?.close();
  await server?.stop();
  rmSync(home, { recursive: true, force: true });
}
