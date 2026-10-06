#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { operator as o } from './host.mjs';

if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('Usage: node --import tsx smoke.mjs [--dry-run]');
if (process.argv.includes('--dry-run')) {
  console.log('DRY RUN: isolated Storytree home; read the copied arcs and plan; create/claim/release/drop one throwaway project; verify tailnet address. No changes.');
} else {
  process.env.STORYTREE_HOME = o.ISOLATED;
  for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];
  const { connect } = await import('@storytree/library');
  const { claim, release, openActivityLog, readClaims } = await import('@storytree/agent-link');
  const env = { STORYTREE_HOME: o.ISOLATED };
  const arcs = await o.run('pnpm', ['storytree', 'arc', 'list'], { env });
  const plan = await o.run('pnpm', ['storytree', 'tree'], { env });
  assert.ok(arcs.includes('arc_34390ae9d2e1'));
  assert.ok(plan.includes('capability_'));
  console.log('Copied arc list and plan read through the isolated CLI.');
  const project = 'library-host-smoke-' + randomBytes(8).toString('hex');
  const tree = await connect({ address: `postgres://${o.OWNER}@127.0.0.1:5432/postgres` });
  let made = false;
  try {
    assert.ok(!(await tree.listProjects()).includes(project));
    const library = await tree.openProject(project);
    made = true;
    const story = await library.addStory({ title: 'Library host smoke' });
    const capability = await library.addCapability({ story: story.id, title: 'Claim and release' });
    const log = await openActivityLog(tree);
    const context = { library, log, project, session: project, harness: 'codex' };
    assert.equal((await claim(context, capability.id, 'Check copied library')).ok, true);
    assert.equal((await readClaims(log, project)).length, 1);
    assert.equal((await release(context, capability.id)).ok, true);
    assert.equal((await readClaims(log, project)).length, 0);
    const tailnet = await connect({ address: `postgres://${o.OWNER}@mickh-a520i-ac:5432/postgres` });
    try {
      assert.equal((await (await tailnet.openProject(project)).projectTree()).stories[0].title, 'Library host smoke');
    } finally { await tailnet.close(); }
    await log.close();
    console.log('Create/claim/release/read over tailnet passed in the throwaway project.');
  } finally {
    if (made) await tree.dropProject(project);
    await tree.close();
  }
  console.log('Throwaway project deleted. The real Storytree home was untouched.');
}
