// Helpers for these manual Linux probes; no product hook, runner or CI integration.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

export { sleep };
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const home = realpathSync(process.env.STORYTREE_HOME || '/nonexistent');
if (!home.startsWith('/tmp/storytree-chaos.') || !existsSync(path.join(home, '.chaos-throwaway'))) {
  throw new Error('Requires /tmp/storytree-chaos.*/.chaos-throwaway');
}
export const { url } = JSON.parse(readFileSync(path.join(home, 'host.json'), 'utf8'));
export const emit = (event, detail = {}) => console.log(JSON.stringify({ event, ...detail }));
export function project(name) {
  const folder = path.join(home, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, '.storytree.json'), JSON.stringify({ project: name }));
  return folder;
}
export async function sql(database = 'postgres') {
  const address = new URL(url);
  address.pathname = '/' + database;
  const client = new pg.Client({ connectionString: address.href, application_name: 'chaos-observer' });
  client.on('error', error => emit('observer-connection-error', { message: error.message }));
  await client.connect();
  return client;
}
export function child(file, args = [], cwd = root, env = {}) {
  const began = Date.now();
  const proc = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(root, file), ...args], {
    cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  proc.stdout.on('data', chunk => { stdout += chunk; });
  proc.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    proc.once('error', reject);
    proc.once('close', (code, signal) => resolve({ code, signal, ms: Date.now() - began, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  return { proc, done };
}
export function cli(args, folder) {
  const result = child('packages/cli/src/bins/storytree.ts', args, folder);
  result.proc.stdin.end();
  return result;
}
export function hook(session, folder) {
  const result = child('packages/agent-link/src/bins/storytree-hook.ts', ['claude-code'], folder);
  result.proc.stdin.end(JSON.stringify({ session_id: session, cwd: folder, hook_event_name: 'PostToolUse',
    tool_name: 'Write', tool_input: { file_path: path.join(folder, 'probe.txt'), content: 'probe' },
    tool_response: { type: 'create' }, tool_use_id: session }));
  return result;
}
export async function waitQuery(observer, pattern, timeout = 4000) {
  const began = Date.now();
  do {
    const { rows } = await observer.query("SELECT pid, datname, state, wait_event_type, wait_event, query FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND application_name <> 'chaos-observer' AND state = 'active' AND query LIKE $1", [pattern]);
    if (rows.length) { emit('observed-in-flight', { rows }); return rows; }
    await sleep(25);
  } while (Date.now() - began < timeout);
  throw new Error('Did not observe in-flight query: ' + pattern);
}
