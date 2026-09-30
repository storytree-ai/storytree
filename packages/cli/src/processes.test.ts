import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { verifyPayload, writePayloadManifest } from '@storytree/app-setup/deliver';
import { buildBins } from '@storytree/agent-link/bins';
import { launchOwned, probeProcess, type RunRecord } from '@storytree/processes';
import { BuiltCommand, storytree } from './testing/cli.js';

for (const installed of [false, true]) test(`processes 3.4/3.6/4.1/5.1: ${installed ? 'installed' : 'standalone'} CLI inventories, stops and clears offline`, async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'processes-door-'));
  const command = new BuiltCommand();
  const children: RunRecord[] = [];
  t.after(async () => {
    await Promise.all(children.map(stopChild));
    command.remove();
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await command.build(installed ? async dir => {
    const install = path.join(dir, 'installed app');
    const desktop = path.join(dir, 'desktop');
    const payload = path.join(desktop, 'dist', 'agent-tools', 'x64');
    await buildBins(payload);
    await mkdir(install, { recursive: true });
    // The installer supplies these three assets; this pins verification of the real bin output.
    await writeFile(path.join(install, 'storytree-0.3.exe'), 'app fixture');
    await writeFile(path.join(payload, 'node.exe'), 'runtime fixture');
    await writeFile(path.join(payload, 'storytree-deliver.mjs'), '// delivery fixture');
    writePayloadManifest(payload, 'x64', '24.21.0');
    // Exercise the actual packager copy with the desktop's rules before verifying/running it.
    const config = JSON.parse(await readFile(new URL('../../../apps/desktop/package.json', import.meta.url), 'utf8'));
    const require = createRequire(import.meta.url);
    const { getFileMatchers, copyFiles } = createRequire(require.resolve('electron-builder'))('app-builder-lib/out/fileMatcher.js');
    const rules = config.build.extraResources.filter((rule: { to: string }) => rule.to.startsWith('agent-tools'));
    const matchers = getFileMatchers({ extraResources: rules }, 'extraResources', path.join(install, 'resources'), {
      defaultSrc: desktop, globalOutDir: path.join(dir, 'release'), customBuildOptions: {},
      macroExpander: (value: string) => value.replaceAll('${arch}', 'x64'),
    });
    await copyFiles(matchers);
    return verifyPayload(install, 'x64', 'win32').cli;
  } : undefined);
  const runs = [];
  for (const session of ['caller', 'other']) {
    const launched = await launchOwned({ home: path.join(home, 'own'), owner: { session, harness: 'codex' },
      command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], folder: home });
    if (launched.status === 'tracked') children.push(launched.run);
    assert.equal(launched.status, 'tracked');
    if (launched.status !== 'tracked') throw new Error('untracked test child');
    runs.push(launched.run);
  }
  const invoke = (args: string[], identified = true, extra: Record<string, string> = {}) => storytree(command.script, ['processes', ...args], {
    cwd: home, home, env: { CODEX_THREAD_ID: identified ? 'caller' : '', ...extra },
  });
  const all = await invoke(['--all'], false);
  assert.equal(all.code, 0, all.stderr);
  for (const run of runs) assert.ok(all.stdout.includes(run.id), all.stdout);
  // The story's old name still answers, but the families list names only the new one.
  const alias = await storytree(command.script, ['own', '--all'], { cwd: home, home, env: { CODEX_THREAD_ID: '' } });
  assert.equal(alias.code, 0, alias.stderr);
  for (const run of runs) assert.ok(alias.stdout.includes(run.id), alias.stdout);
  const listed = await storytree(command.script, [], { cwd: home, home, env: {} });
  assert.match(listed.stdout, /^ +processes +/m);
  assert.doesNotMatch(listed.stdout, /^ +own +/m);
  assert.match(all.stdout, /LIVE/);
  assert.match(all.stdout, /no.*stop authority/i);
  assert.match(all.stdout, /untracked/);
  const missing = await invoke([], false);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /session identity.*--all/s);
  const self = await invoke([]);
  assert.equal(self.code, 0, self.stderr);
  assert.ok(self.stdout.includes(`storytree processes stop ${runs[0]!.id}`));
  assert.ok(!self.stdout.includes(runs[1]!.id));
  const uncertain = await invoke([], true, { CLAUDE_CODE_SESSION_ID: 'another-session' });
  assert.equal(uncertain.code, 1, uncertain.stdout + uncertain.stderr);
  assert.match(uncertain.stderr, /identity.*--all/s);
  for (const args of [['stop', runs[0]!.id], ['clear']]) {
    const missing = await invoke(args, false);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /identity.*--all/s);
  }
  const retained = await invoke(['clear']);
  assert.equal(retained.code, 0, retained.stderr);
  const before = JSON.parse(retained.stdout);
  assert.deepEqual(before.clear.removed, []);
  assert.deepEqual(before.clear.retained.map((row: { run: string }) => row.run), [runs[0]!.id]);
  assert.deepEqual(before.clear.failed, []);
  assert.deepEqual(before.clear.gaps, []);
  const stopped = await invoke(['stop', ...runs.map(run => run.id)]);
  assert.equal(stopped.code, 1, stopped.stdout + stopped.stderr);
  const result = JSON.parse(stopped.stderr);
  assert.deepEqual(result.targets.map((target: { status: string }) => target.status), ['stopped', 'refused']);
  const gone = await invoke(['stop', runs[0]!.id]);
  assert.equal(gone.code, 0, gone.stderr);
  assert.equal(JSON.parse(gone.stdout).targets[0].status, 'already-gone');
  const corrupt = path.join(home, 'own', 'runs', 'unreadable.json');
  await writeFile(corrupt, '{');
  const incomplete = await invoke(['clear']);
  assert.equal(incomplete.code, 1, incomplete.stdout);
  const partial = JSON.parse(incomplete.stderr);
  assert.ok(partial.clear.gaps.length > 0);
  assert.equal(partial.closing.status, 'incomplete');
  await rm(corrupt);
  const cleared = await invoke(['clear']);
  assert.equal(cleared.code, 0, cleared.stderr);
  const after = JSON.parse(cleared.stdout);
  assert.deepEqual(after.clear.removed, [runs[0]!.id]);
  assert.deepEqual(after.clear.retained, []);
  assert.deepEqual(after.clear.failed, []);
  assert.deepEqual(after.clear.gaps, []);
  assert.deepEqual(after.closing.inventory.rows.map((row: { run: { id: string } }) => row.run.id), [runs[1]!.id]);
  assert.equal(after.closing.status, 'remaining'); // runs[1] is still live.
  const claude = await invoke([], false, { CLAUDE_CODE_SESSION_ID: 'caller' });
  assert.equal(claude.code, 0, claude.stderr);
  assert.match(claude.stdout, /No recorded runs/); // Different harness is not Codex's owner.
  for (const args of [['clear', 'extra'], ['clear', '--all'], ['stop'], ['--bogus'], ['stop', '--all']]) {
    assert.equal((await invoke(args)).code, 2, `invalid arguments: ${args.join(' ')}`);
  }
});

/** Kill a test child still running, never whatever process has since been given its PID. */
async function stopChild(run: RunRecord): Promise<void> {
  if (run.birth.state !== 'live') return;
  const { identity } = run.birth;
  // Windows reuses a PID at once: a raw kill after the child exits can end a Postgres backend and
  // send the shared test server into crash recovery under every other test.
  if ((await probeProcess(identity)).state !== 'live') return;
  try { process.kill(identity.pid, 'SIGKILL'); } catch { return; }
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await probeProcess(identity)).state === 'gone') return;
    await pause(20);
  }
  assert.fail(`test child ${identity.pid} did not exit`);
}
