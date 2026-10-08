// Independent bounded review. Only /evidence sources and disposable /tmp fixtures are used.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { createServer, request } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const hash = text => createHash('sha256').update(text).digest('hex');
const emit = value => console.log(JSON.stringify(value));
const source = (version, file) => readFileSync(`/evidence/sources/${version}/${file}`, 'utf8');
const pgBin = '/usr/lib/postgresql/16/bin';
const admin = 'review_bootstrap';
const owner = 'review_owner';
const ci = 'storytree-ci-health@storytree-498613.iam'; // Synthetic local role, no real identity/token.
const database = 'storytree_storytree';
const pgData = '/tmp/review-pg';
const socket = '/tmp/review-socket';
let commands = 0;
function command(argv, { input, expected = 0 } = {}) {
  const out = spawnSync(argv[0], argv.slice(1), { input, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  emit({ kind: 'command', index: ++commands, argv, stdin: input ?? null, exit_code: out.status,
    stdout: out.stdout, stderr: out.stderr, error: out.error?.message ?? null });
  assert.equal(out.status, expected, `${argv[0]} status`);
  return out.stdout;
}
function sql(text, role = owner, db = database, expected = 0) {
  return command([`${pgBin}/psql`, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '5432', '-U', role, '-d', db], { input: text, expected }).trim();
}
function literal(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') { assert(Number.isSafeInteger(value)); return String(value); }
  return `'${value.replaceAll("'", "''")}'`;
}
function esm(ts) { return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(ts)).toString('base64')}`); }

emit({ kind: 'isolation', node: process.version, interfaces: networkInterfaces(), limits: {
  network: 'bwrap --unshare-all; isolated loopback only; no host network or credentials',
  filesystem: 'read-only /usr, selected Node runtime and /evidence; writable disposable /tmp only',
  graph_vertices: 12, visits_per_graph: 10000, command_timeout_ms: 15000,
  tests: 'No browsers, production databases, credential issuance, cloud services or real host-data probes.'
}});
command([`${pgBin}/postgres`, '--version']);
mkdirSync(socket);
command([`${pgBin}/initdb`, '-D', pgData, '-U', admin, '--auth=trust', '--no-locale', '--encoding=UTF8']);
writeFileSync(`${pgData}/postgresql.conf`, `listen_addresses = ''\nunix_socket_directories = '${socket}'\nstatement_timeout = '3s'\n`, { flag: 'a' });
let started = false;
try {
  command([`${pgBin}/pg_ctl`, '-D', pgData, '-l', '/tmp/postgres.log', '-w', 'start']);
  started = true;
  sql(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE "${ci}" LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;`, admin, 'postgres');
  for (const version of ['original', 'current']) {
    sql(`CREATE DATABASE ${database} OWNER ${owner};`, admin, 'postgres');
    const { PROJECT_SCHEMA } = await esm(source(version, 'packages/library/src/project/schema.ts'));
    for (const statement of PROJECT_SCHEMA) sql(statement);
    const grants = source(version, 'infra/ci-health/grants.sql');
    assert.equal(grants, source(version, 'infra/library-host/grants.sql'));
    sql(grants);
    assert.equal(sql('SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;', ci), 'f|f');
    sql(`INSERT INTO record VALUES ('review-decision','decision',1,'{"number":10}',now(),now());
      INSERT INTO record_event (record_id,type,action,record) VALUES ('review-decision','decision','created','{"type":"decision","fields":{"number":10}}');`);
    sql(`INSERT INTO record VALUES ('review-health','health',1,'{}',now(),now());
      INSERT INTO record_event (record_id,type,action,record) VALUES ('review-health','health','created','{"type":"health","fields":{}}');`, ci);
    sql(`INSERT INTO record VALUES ('refused-decision','decision',1,'{}',now(),now());`, ci, database, 3);
    sql(`INSERT INTO record_event (record_id,type,action,record) VALUES ('review-decision','health','updated','{"type":"health","fields":{"number":700}}');`, ci, database, 3);
    sql(`INSERT INTO record_event (record_id,type,action,record) VALUES ('new-decision-history','decision','created','{"type":"decision","fields":{"number":700}}');`, ci, database, 3);
    const pg = source(version, 'packages/library/src/transactions/pg.ts');
    const start = pg.indexOf('async function numberedIn(');
    const end = pg.indexOf('\n}\n', start) + 2;
    assert(start > 0 && end > start);
    const excerpt = pg.slice(start, end);
    const { numbered } = await esm(source(version, 'packages/library/src/transactions/records.ts'));
    const numberedIn = vm.runInNewContext(`${stripTypeScriptTypes(excerpt)}\nnumberedIn`, { numbered }, { timeout: 1000 });
    const queries = [];
    const client = { query: async (query, values) => {
      queries.push({ query, values });
      const answer = sql(`PREPARE review_query AS ${query}; EXECUTE review_query(${values.map(literal).join(',')});`);
      return query.includes('AS highest') ? { rows: [{ highest: answer }] } : { rows: answer === '' ? [] : [{ value: answer }] };
    }};
    const input = { id: 'new-owner-decision', type: 'decision', fields: {}, sequence: 'number', sequenceFloor: 10, sequenceNeverHeld: true };
    const before = (await numberedIn(client, input)).fields.number;
    assert.equal(before, 11);
    sql(`INSERT INTO record_event (record_id,type,action,record) VALUES ('review-history-only','health','created','{"type":"health","fields":{"number":700}}');`, ci);
    const after = (await numberedIn(client, input)).fields.number;
    assert.equal(after, 701);
    const ordinaryProject = (await numberedIn(client, { ...input, sequenceNeverHeld: false })).fields.number;
    assert.equal(ordinaryProject, 11);
    let explicitError;
    try { await numberedIn(client, { ...input, fields: { number: 700 } }); } catch (error) { explicitError = error.name; }
    assert.equal(explicitError, 'NumberTakenError');
    assert.equal((await numberedIn(client, { ...input, fields: { number: 699 } })).fields.number, 699);
    assert.equal(sql("SELECT count(*) FROM record WHERE id = 'review-history-only';"), '0');
    emit({ kind: 'delivery-infra-001', version, result: 'PASS: mechanism reproduced', before, after,
      ordinary_project_next: ordinaryProject, explicit_reserved_number_error: explicitError,
      controls: 'health succeeds; direct decision row/history and history under an existing decision id denied by RLS',
      extracted_function_sha256: hash(excerpt), grants_sha256: hash(grants), queries,
      limits: 'Real PostgreSQL 16 policies, original allocator queries and numbered function; top-level Knowledge/SchemaRecords invocation is statically traced, not executed. No deployment/credential compromise claim.' });
    sql(`DROP DATABASE ${database};`, admin, 'postgres');
  }
} finally {
  if (started) command([`${pgBin}/pg_ctl`, '-D', pgData, '-m', 'fast', '-w', 'stop']);
}

for (const version of ['original', 'current']) {
  const file = 'packages/guardrails/src/package-rule/package-rule.ts';
  const original = source(version, file);
  const marker = 'const at = trail.indexOf(name);';
  assert.equal(original.split(marker).length, 2);
  const instrumented = `export const reviewMetrics = { visits: 0 };\n` + original.replace(marker,
    `if (++reviewMetrics.visits > 10000) throw new Error('review visit cap');\n${marker}`);
  const normal = await esm(original);
  const measured = await esm(instrumented);
  const cases = [
    { name: 'chain', adjacency: [[1], [2], [3], []], visits: 10, cycles: false },
    { name: 'diamond', adjacency: [[1, 2], [3], [3], []], visits: 10, cycles: false },
    { name: 'cycle', adjacency: [[1], [0]], visits: 6, cycles: true },
    ...[4, 8, 12].map(n => ({ name: `complete-dag-${n}`, adjacency: Array.from({ length: n }, (_, i) => Array.from({ length: n - i - 1 }, (_, j) => i + j + 1)), visits: 2 ** n - 1, cycles: false })),
  ];
  for (const fixture of cases) {
    const root = `/tmp/graph-${version}-${fixture.name}`;
    for (let i = 0; i < fixture.adjacency.length; i++) {
      const dir = `${root}/packages/p${i}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/package.json`, JSON.stringify({ name: `p${i}`, dependencies: Object.fromEntries(fixture.adjacency[i].map(j => [`p${j}`, '*'])) }));
    }
    const unmodified = normal.packageProblems(root);
    measured.reviewMetrics.visits = 0;
    const observed = measured.packageProblems(root);
    assert.deepEqual(observed, unmodified);
    assert.equal(observed.some(p => p.includes('cycle:')), fixture.cycles);
    assert.equal(measured.reviewMetrics.visits, fixture.visits);
    emit({ kind: 'delivery-infra-002', version, fixture: fixture.name, vertices: fixture.adjacency.length,
      edges: fixture.adjacency.flat().length, visits: measured.reviewMetrics.visits, problems: observed,
      source_sha256: hash(original), instrumented_source_sha256: hash(instrumented),
      limits: 'Actual exported packageProblems on synthetic manifest files, with unmodified-output control; counts on tiny graphs only. No stress/large-graph test or lower-trust deployment demonstrated.' });
    rmSync(root, { recursive: true });
  }
}

const handlers = [
  'packages/website/evidence/terminal.mjs', 'packages/website/evidence/turn/capture.mjs',
  'packages/website/evidence/journey/capture.mjs', 'packages/website/evidence/arrival/capture.mjs',
  'packages/website/evidence/nameplates-phone/capture.mjs', 'packages/website/evidence/warm-globe/measure.mjs',
  'packages/forest-world/evidence/flat-canvas-retired/capture-website.mjs', 'packages/website/evidence/capture.mjs',
];
const fixtureRoot = '/tmp/capture-fixture';
const dist = `${fixtureRoot}/dist`;
mkdirSync(dist, { recursive: true });
writeFileSync(`${dist}/index.html`, 'synthetic public asset');
writeFileSync(`${dist}/404.html`, 'synthetic missing asset');
writeFileSync(`${fixtureRoot}/marker.txt`, 'synthetic sibling marker');
for (const version of ['original', 'current']) {
  for (const file of handlers) {
    const text = source(version, file);
    const start = text.indexOf('const server = createServer(');
    const end = text.indexOf('\n});', start) + 4;
    assert(start >= 0 && end > start);
    const excerpt = text.slice(start, end);
    const server = vm.runInNewContext(`${excerpt}\nserver`, { createServer, readFile, path, dist, types: {}, URL }, { timeout: 1000 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const fetchPath = target => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.address().port, path: target, method: 'GET' }, res => {
        let body = '';
        res.setEncoding('utf8'); res.on('data', data => { body += data; if (body.length > 4096) req.destroy(new Error('body cap')); });
        res.on('end', () => resolve({ target, status: res.statusCode, body }));
      });
      req.setTimeout(2000, () => req.destroy(new Error('request deadline')));
      req.on('error', reject); req.end();
    });
    try {
      const normal = await fetchPath('/');
      assert.equal(normal.status, 200); assert.equal(normal.body, 'synthetic public asset');
      const encoded = await fetchPath('/%2e%2e%2fmarker.txt');
      const plain = await fetchPath('/../marker.txt');
      const guarded = file === 'packages/website/evidence/capture.mjs';
      assert.equal(encoded.status, guarded ? 403 : 200);
      assert.equal(encoded.body, guarded ? '' : 'synthetic sibling marker');
      assert.equal(plain.status, 404);
      emit({ kind: 'delivery-infra-003', version, file, source_sha256: hash(text),
        handler_sha256: hash(excerpt), normal, encoded, plain,
        limits: 'Real HTTP and filesystem on an extracted unchanged handler in a network namespace, same UID and synthetic files only. Complete helper/browser not run; no multi-user exposure, inaccessible host file, CORS/origin bypass or deployed website exploit demonstrated.' });
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
}
emit({ kind: 'complete', result: 'PASS', commands });
