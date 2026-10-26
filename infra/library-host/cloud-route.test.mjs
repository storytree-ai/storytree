import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./cloud-route.sh', import.meta.url).pathname;
// The script runs only on the Mint box; its GNU tools (stat -c, realpath -m) are Linux's.
const linuxOnly = { skip: process.platform !== 'linux' && 'platform:linux: cloud-route.sh runs only on the Mint box' };
const unit = name => execFileSync('bash', ['-c', `source "$1"; ${name}`, 'cloud-route-test', script], { encoding: 'utf8' });
const settings = text => text.split('\n').filter(l => /^[A-Za-z]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]);

test('wsproxy listens only on loopback, may reach only 127.0.0.1:5432, and runs unprivileged', linuxOnly, () => {
  const s = settings(unit('wsproxy_unit'));
  const env = Object.fromEntries(s.filter(([k]) => k === 'Environment').map(([, v]) => v.split(/=(.*)/s).slice(0, 2)));
  assert.equal(env.LISTEN_PORT, '127.0.0.1:8080');
  assert.match(env.PROMETHEUS_BIND, /^127\.0\.0\.1:\d+$/);
  // wsproxy dials what this pattern admits; the destination comes from the request's address alone.
  assert.equal(env.USE_HOST_HEADER, 'false');
  assert.equal(env.APPEND_PORT, '');
  const allow = new RegExp(env.ALLOW_ADDR_REGEX);
  assert.ok(allow.test('127.0.0.1:5432'));
  for (const elsewhere of ['127.0.0.1:22', '127.0.0.1:54321', '127.0.0.1:543', 'localhost:5432', '127.0.0.10:5432', '127x0x0x1:5432', '1127.0.0.1:5432', '192.0.2.10:5432', 'example.com:5432']) {
    assert.ok(!allow.test(elsewhere), elsewhere);
  }
  const has = (k, v) => assert.ok(s.some(([a, b]) => a === k && b === v), `${k}=${v}`);
  has('DynamicUser', 'yes');
  has('IPAddressDeny', 'any');
  has('IPAddressAllow', 'localhost');
  has('CapabilityBoundingSet', '');
});

test("cloudflared reads the tunnel's token from the root-only file through systemd, never from its command line", linuxOnly, () => {
  const text = unit('cloudflared_unit');
  const s = settings(text);
  const [name, from] = s.find(([k]) => k === 'LoadCredential')[1].split(/:(.*)/s);
  // The file the owner's real run installs, root:root 600 (README.md, "Cloud sessions' HTTPS route").
  assert.equal(from, '/etc/storytree/cloudflared-mint-library.token');
  const exec = s.find(([k]) => k === 'ExecStart')[1].split(' ');
  assert.equal(exec[exec.indexOf('--token-file') + 1], `%d/${name}`);
  assert.ok(!exec.includes('--token') && !/TUNNEL_TOKEN/.test(text), 'no token on the command line or in the environment');
  assert.match(exec[exec.indexOf('--metrics') + 1], /^127\.0\.0\.1:\d+$/);
  assert.ok(exec.includes('--no-autoupdate'), 'the pinned version is not replaced behind the review');
});

test('the dry run names every change it would make and makes none', linuxOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cloud-route-'));
  try {
    const calls = join(dir, 'calls.log');
    writeFileSync(calls, '');
    const stub = (name, body = '') => {
      writeFileSync(join(dir, name), `#!/usr/bin/env bash\nprintf '%s\\n' "${name} $(printf '%s ' "$@" | tr '\\n' ' ')" >> "${calls}"\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
    };
    // Postgres listens on 5432 and pg_hba admits loopback with a password; nothing else is installed.
    stub('ss', 'case "$*" in *":5432"*) echo "LISTEN 0 200 127.0.0.1:5432 0.0.0.0:*";; esac');
    stub('psql', 'echo 125');
    stub('dpkg', '[ "$1" = --print-architecture ] && echo amd64');
    stub('dpkg-query', 'exit 1');
    for (const writer of ['curl', 'install', 'tar', 'chown', 'chmod', 'mv', 'cp', 'mktemp', 'systemctl', 'go']) stub(writer);
    // The install's folders point into the throwaway one, so a box where the services already run reads as a fresh one.
    const units = join(dir, 'systemd');
    const wsproxyDir = join(dir, 'storytree-wsproxy');
    const r = spawnSync('bash', ['-c', 'source "$1"; UNIT_DIR=$2; WSPROXY_DIR=$3; WSPROXY_BIN=$WSPROXY_DIR/${WSPROXY_BIN##*/}; main --dry-run',
      'cloud-route-test', script, units, wsproxyDir], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const ran = readFileSync(calls, 'utf8').split('\n').filter(Boolean).filter(l => !/^(ss|psql|dpkg --print-architecture|dpkg-query)( |$)/.test(l));
    assert.deepEqual(ran, [], 'the dry run ran a command that changes the machine');
    for (const named of ['would download https://github.com/cloudflare/cloudflared/', 'would download https://go.dev/dl/', `would write ${units}/storytree-wsproxy.service`,
      `would write ${units}/storytree-cloudflared.service`, `then install it as ${wsproxyDir}/wsproxy-`, 'would run: systemctl enable storytree-wsproxy.service storytree-cloudflared.service',
      'no change to pg_hba or Postgres', '(dry run: nothing changed)']) {
      assert.ok(r.stdout.includes(named), `${named}\n---\n${r.stdout}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
