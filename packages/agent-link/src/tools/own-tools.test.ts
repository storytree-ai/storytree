import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { launchOwned } from '@storytree/own';
import { listRuns } from '@storytree/own/listing';
import { createAgentTools } from './server.js';

test('own 3.4/3.6/4.1: MCP reads the offline ledger and stops only the named caller scope', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'own-tools-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const tools = createAgentTools({ folder: home, dataDir: path.join(home, 'pgdata'), env: {} });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'codex-mcp-client', version: 'test' });
  t.after(async () => { await client.close(); await tools.close(); });
  await tools.server.connect(serverSide);
  await client.connect(clientSide);
  const runs = [];
  for (const subagent of ['builder', 'sibling']) {
    const launched = await launchOwned({ home: path.join(home, 'own'),
      owner: { session: 'caller', harness: 'codex', agent: { subagent } },
      command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], folder: home });
    if (launched.pid) t.after(() => { try { process.kill(launched.pid!, 'SIGKILL'); } catch {} });
    assert.equal(launched.status, 'tracked');
    if (launched.status !== 'tracked') throw new Error('untracked test child');
    runs.push(launched.run);
  }
  const call = (name: string, args = {}, meta?: Record<string, unknown>) => client.callTool({ name, arguments: args,
    ...(meta ? { _meta: meta } : {}) });
  const all = await call('list_all_runs');
  assert.equal(all.isError, undefined, JSON.stringify(all));
  const inventory = all.structuredContent!.inventory as Awaited<ReturnType<typeof listRuns>>;
  const direct = await listRuns({ home: path.join(home, 'own'), scope: 'all' });
  assert.deepEqual(inventory.rows.map(row => [row.run.id, row.process.state, row.request.state, row.stop]),
    direct.rows.map(row => [row.run.id, row.process.state, row.request.state, row.stop]));
  const missing = await call('list_own_runs');
  assert.equal(missing.isError, true, JSON.stringify(missing));
  assert.match(JSON.stringify(missing), /session identity/);
  const meta = { sessionId: 'caller', threadId: 'builder' };
  const self = await call('list_own_runs', {}, meta);
  assert.equal(self.isError, undefined, JSON.stringify(self));
  const rows = (self.structuredContent!.inventory as typeof inventory).rows;
  assert.deepEqual(rows.map(row => row.run.id), [runs[0]!.id]);
  assert.equal(rows[0]!.stop.available, true);
  assert.equal(rows[0]!.stop.available && rows[0]!.stop.tool, 'stop_own_run');
  const stopped = await call('stop_own_run', { runs: runs.map(run => run.id) }, meta);
  assert.equal(stopped.isError, true, JSON.stringify(stopped));
  const result = stopped.structuredContent!.result as { targets: { status: string }[] };
  assert.deepEqual(result.targets.map(target => target.status), ['stopped', 'refused']);
});
