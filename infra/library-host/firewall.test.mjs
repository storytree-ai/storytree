import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./firewall.sh', import.meta.url).pathname;
// The script runs only on the Mint box.
const linuxOnly = { skip: process.platform !== 'linux' && 'platform:linux: firewall.sh runs only on the Mint box' };

// Runs main with ufw, ip and id stubbed (each call logged) and the ufw defaults file in a throwaway folder.
function run(args, { tailscale = true, defaults = 'IPV6=no\n', uid = '1000' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'firewall-'));
  try {
    const calls = join(dir, 'calls.log');
    writeFileSync(calls, '');
    const stub = (name, body = '') => {
      writeFileSync(join(dir, name), `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $*" >> "${calls}"\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
    };
    stub('ufw');
    stub('ip', tailscale ? '' : 'exit 1');
    stub('id', `echo ${uid}`);
    const defaultsFile = join(dir, 'default-ufw');
    writeFileSync(defaultsFile, defaults);
    const r = spawnSync('bash', ['-c', 'source "$1"; UFW_DEFAULTS=$2; shift 2; main "$@"', 'firewall-test', script, defaultsFile, ...args],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    const ufw = readFileSync(calls, 'utf8').split('\n').filter(l => l.startsWith('ufw '));
    return { ...r, ufw, defaults: readFileSync(defaultsFile, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rules = [
  'ufw default deny incoming',
  'ufw default allow outgoing',
  'ufw allow in on tailscale0 to any port 22 proto tcp',
  'ufw allow in on tailscale0 to any port 5432 proto tcp',
  'ufw allow in from 192.168.1.0/24 to any port 22 proto tcp',
  'ufw --force enable',
];

test('the dry run prints every rule the real run would set, IPv6 included, and changes nothing', linuxOnly, () => {
  const r = run(['--dry-run', '--lan-ssh', '192.168.1.0/24']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.ufw, [], 'the dry run ran ufw');
  assert.equal(r.defaults, 'IPV6=no\n', 'the dry run edited the ufw defaults');
  assert.deepEqual(r.stdout.split('\n').filter(l => l.startsWith('would run: ')).map(l => l.slice('would run: '.length)), rules);
  assert.ok(r.stdout.includes('would set IPV6=yes'), r.stdout);
  assert.ok(r.stdout.includes('(dry run: nothing changed)'), r.stdout);
});

test('the real run sets those rules with IPv6 on, and a rerun leaves the defaults file as it is', linuxOnly, () => {
  const r = run([], { uid: '0' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.ufw, [...rules.filter(c => !c.includes('192.168')), 'ufw status verbose']);
  assert.equal(r.defaults, 'IPV6=yes\n');
  const again = run([], { uid: '0', defaults: r.defaults });
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.equal(again.defaults, 'IPV6=yes\n');
});

test('with no Tailscale interface it refuses and changes nothing, so the box is not locked out', linuxOnly, () => {
  const r = run([], { tailscale: false, uid: '0' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.ufw, []);
  assert.equal(r.defaults, 'IPV6=no\n');
});
