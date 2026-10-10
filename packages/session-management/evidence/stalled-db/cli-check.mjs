// Run from the repository root: flock /tmp/storytree-heavy.lock node --import tsx packages/session-management/evidence/stalled-db/cli-check.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer, connect as openSocket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCommand } from '../../../cli/src/bins/build.ts';
import { start } from '@storytree/local-postgres';
const dir = mkdtempSync(path.join(tmpdir(), 'stalled-db-cli-'));
let database;
const held = new Set();
let stalled = true;
let silent;
try {
  const home = path.join(dir, 'home');
  const folder = path.join(dir, 'site');
  mkdirSync(home); mkdirSync(folder);
  writeFileSync(path.join(folder, '.storytree.json'), JSON.stringify({project: 'stalled-cli-proof'}));
  const script = await buildCommand(path.join(dir, 'bin'));
  database = await start({dataDir: path.join(dir, 'database'), owner: 'stalled-db CLI proof'});
  const upstream = new URL(database.url);
  silent = createServer(socket => {
    held.add(socket); socket.on('error', () => {});
    if (stalled) { socket.resume(); return; }
    const target = openSocket(Number(upstream.port), upstream.hostname);
    held.add(target); target.on('error', () => socket.destroy());
    socket.on('close', () => target.destroy());
    socket.pipe(target).pipe(socket);
  });
  await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve));
  writeFileSync(path.join(home, 'pgdata.owner.json'), JSON.stringify({pid: process.pid, port: silent.address().port, token: 'proof', owner: 'proof', startedAt: new Date().toISOString()}));
  const run = () => new Promise(resolve => {
    const started = performance.now();
    execFile(process.execPath, [script, 'arc', 'list'], {cwd: folder, env: {...process.env, STORYTREE_HOME: home}, timeout: 6_500}, (error, stdout, stderr) => resolve({code: error?.code ?? 0, killed: error?.killed ?? false, ms: Math.round(performance.now() - started), stdout, stderr}));
  });
  const failed = await run(); console.log(JSON.stringify({stalled: failed}, null, 2));
  assert.equal(failed.killed, false); assert.equal(failed.code, 1);
  assert.ok(failed.ms < 4_000); assert.match(failed.stderr, /storytree isn't reachable.*Check.*app.*try again/);
  stalled = false;
  const recovered = await run(); console.log(JSON.stringify({recovered}, null, 2));
  assert.equal(recovered.code, 0); assert.match(recovered.stdout, /no arcs/i);
} finally {
  for (const socket of held) socket.destroy();
  if (silent) await new Promise(resolve => silent.close(resolve));
  await database?.stop();
  rmSync(dir, {recursive: true, force: true});
}
