import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { buildBins } from '@storytree/app-setup/bins';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { launchOwned, type RunRecord } from '@storytree/processes';
import { stopTestChild, testChildArgs } from '@storytree/processes/testing';
import { listRuns } from '@storytree/processes/listing';
import { createAgentTools } from './server.js';
import { openActivityLog } from '@storytree/agent-link';
import { removeTempDir } from '@storytree/agent-link/testing/folders';
import { connect, ConnectionError } from '@storytree/library';
import { libraryDown } from './answers.js';
import { approveCheckout, placeTestServer, testServerUrl, uniqueProjectName, dropTestProjects } from '@storytree/agent-link/testing/pg';

for (const installed of [false, true]) test(`processes 3.4/3.6/4.1/5.1: own tools, ${installed ? 'installed' : 'source'} MCP reads and clears the offline ledger and stops only its caller scope`, async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'own-tools-'));
  const client = new Client({ name: 'codex-mcp-client', version: 'test' });
  const children: RunRecord[] = [];
  let tools: ReturnType<typeof createAgentTools> | undefined;
  t.after(async () => {
    await client.close();
    await tools?.close();
    try { await Promise.all(children.map(stopTestChild)); } finally { await removeTempDir(home); }
  });
  if (installed) {
    const bins = await buildBins(path.join(home, 'bin'));
    const transport = new StdioClientTransport({ command: process.execPath, args: [bins['storytree-mcp']!], cwd: home,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', STORYTREE_HOME: home,
        HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, 'codex'), CLAUDE_CONFIG_DIR: path.join(home, 'claude') }, stderr: 'pipe' });
    await client.connect(transport);
  } else {
    tools = createAgentTools({ folder: home, dataDir: path.join(home, 'pgdata'), env: {} });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await tools.server.connect(serverSide);
    await client.connect(clientSide);
  }
  const runs = [];
  for (const subagent of ['builder', 'sibling']) {
    const launched = await launchOwned({ home: path.join(home, 'own'),
      owner: { session: 'caller', harness: 'codex', agent: { subagent } },
      command: process.execPath, args: testChildArgs(), folder: home });
    if (launched.status === 'tracked') children.push(launched.run);
    assert.equal(launched.status, 'tracked');
    if (launched.status !== 'tracked') throw new Error('untracked test child');
    runs.push(launched.run);
  }
  const call = (name: string, args = {}, meta?: Record<string, unknown>) => client.callTool({ name, arguments: args,
    ...(meta ? { _meta: meta } : {}) });
  const all = await call('list_all_runs');
  assert.equal(all.isError, undefined, JSON.stringify(all));
  const inventory = (all.structuredContent as Record<string, unknown>).inventory as Awaited<ReturnType<typeof listRuns>>;
  const direct = await listRuns({ home: path.join(home, 'own'), scope: 'all' });
  assert.deepEqual(inventory.rows.map(row => [row.run.id, row.process.state, row.request.state, row.stop]),
    direct.rows.map(row => [row.run.id, row.process.state, row.request.state, row.stop]));
  assert.equal(inventory.shared.length, 1);
  assert.equal(inventory.shared[0]!.state, 'gone');
  assert.equal(inventory.shared[0]!.stop.available, false);
  assert.match(inventory.shared[0]!.reason, /storytree app quit/);
  const missing = await call('list_own_runs');
  assert.equal(missing.isError, true, JSON.stringify(missing));
  assert.match(JSON.stringify(missing), /session identity/);
  const meta = { sessionId: 'caller', threadId: 'builder' };
  const self = await call('list_own_runs', {}, meta);
  assert.equal(self.isError, undefined, JSON.stringify(self));
  const rows = ((self.structuredContent as Record<string, unknown>).inventory as typeof inventory).rows;
  assert.deepEqual(rows.map(row => row.run.id), [runs[0]!.id]);
  assert.equal(rows[0]!.stop.available, true);
  assert.equal(rows[0]!.stop.available && rows[0]!.stop.tool, 'stop_own_run');
  for (const name of ['stop_own_run', 'clear_own_runs']) {
    const unknown = await call(name, name === 'stop_own_run' ? { runs: [runs[0]!.id] } : {});
    assert.equal(unknown.isError, true, JSON.stringify(unknown));
    assert.match(JSON.stringify(unknown), /list_all_runs/);
  }
  const retained = await call('clear_own_runs', {}, meta);
  assert.equal(retained.isError, undefined, JSON.stringify(retained));
  const before = (retained.structuredContent as Record<string, unknown>).clear as { retained: { run: string }[]; removed: string[] };
  assert.deepEqual(before.removed, []);
  assert.deepEqual(before.retained.map(row => row.run), [runs[0]!.id]);
  const stopped = await call('stop_own_run', { runs: runs.map(run => run.id) }, meta);
  assert.equal(stopped.isError, true, JSON.stringify(stopped));
  const result = (stopped.structuredContent as Record<string, unknown>).result as { targets: { status: string }[] };
  assert.deepEqual(result.targets.map(target => target.status), ['stopped', 'refused']);
  const corrupt = path.join(home, 'own', 'runs', 'unreadable.json');
  await writeFile(corrupt, '{');
  const incomplete = await call('clear_own_runs', {}, meta);
  assert.equal(incomplete.isError, true, JSON.stringify(incomplete));
  assert.ok(((incomplete.structuredContent as Record<string, unknown>).clear as { gaps: unknown[] }).gaps.length > 0);
  assert.equal(((incomplete.structuredContent as Record<string, unknown>).closing as { status: string }).status, 'incomplete');
  await rm(corrupt);
  const cleared = await call('clear_own_runs', {}, meta);
  assert.equal(cleared.isError, undefined, JSON.stringify(cleared));
  const after = (cleared.structuredContent as Record<string, unknown>).clear as { removed: string[]; retained: unknown[]; failed: unknown[]; gaps: unknown[] };
  assert.deepEqual(after, { ...after, removed: [runs[0]!.id], retained: [], failed: [], gaps: [] });
  const closing = (cleared.structuredContent as Record<string, unknown>).closing as { status: string; inventory: typeof inventory };
  assert.equal(closing.status, 'remaining');
  assert.deepEqual(closing.inventory.rows.map(row => row.run.id), [runs[1]!.id]);
});

// A Claude MCP server is shared with subagents; its startup environment cannot identify a call.
test('processes 3.6: own tools, offline Claude MCP refuses self authority from a stale server environment', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'own-claude-'));
  const tools = createAgentTools({ folder: home, dataDir: path.join(home, 'pgdata'), env: { CLAUDE_CODE_SESSION_ID: 'stale' } });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'claude-code', version: 'test' });
  t.after(async () => { await client.close(); await tools.close(); await removeTempDir(home); });
  await tools.server.connect(serverSide);
  await client.connect(clientSide);
  const all = await client.callTool({ name: 'list_all_runs', arguments: {} });
  assert.equal(all.isError, undefined, JSON.stringify(all));
  for (const name of ['list_own_runs', 'stop_own_run', 'clear_own_runs']) {
    const answer = await client.callTool({ name, arguments: name === 'stop_own_run' ? { runs: ['unowned'] } : {},
      _meta: { sessionId: 'stale', threadId: 'stale' } });
    assert.equal(answer.isError, true, JSON.stringify(answer));
    assert.match(JSON.stringify(answer), /list_all_runs/);
  }
});

// The caller lookup falls back when the library is down, whichever way it is down.
test('processes 3.6: own tools fall back on a stopped Cloud SQL library as on an unreachable or timed-out one', () => {
  assert.equal(libraryDown(new ConnectionError('stopped', 'The shared library is unreachable: its Cloud SQL instance is not running.')), true);
  assert.equal(libraryDown(new ConnectionError('timeout', 'did not answer within 3 seconds')), true);
  assert.equal(libraryDown(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), true);
  assert.equal(libraryDown(new ConnectionError('database-user', 'Cloud SQL did not let the account in')), false);
  assert.equal(libraryDown(new Error('a defect')), false);
});

test('processes 3.6/4.1: own tools online, Claude hook identity selects only its named subagent, after a session reset', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'own-hook-'));
  const project = uniqueProjectName();
  const children: RunRecord[] = [];
  let log: Awaited<ReturnType<typeof openActivityLog>> | undefined;
  let tools: ReturnType<typeof createAgentTools> | undefined;
  const client = new Client({ name: 'claude-code', version: 'test' });
  t.after(async () => {
    await client.close();
    await tools?.close();
    try { await Promise.all(children.map(stopTestChild)); } finally {
      await log?.close();
      await dropTestProjects([project]);
      await removeTempDir(home);
    }
  });
  await writeFile(path.join(home, '.storytree.json'), JSON.stringify({ project }));
  await approveCheckout(home, project, home);
  placeTestServer(path.join(home, 'pgdata'));
  const server = await connect({ url: testServerUrl() });
  await (await server.openProject(project)).close().finally(() => server.close()); // set up, as a marked folder's project is
  log = await openActivityLog(testServerUrl());
  await log.append(project, { session: 'reset-session', harness: 'claude-code', source: 'hook', folder: home,
    kind: 'tool-requested', tool: 'list_own_runs', call: 'hook-call', agent: { subagent: 'builder' } });
  const runs = [];
  for (const subagent of ['builder', 'sibling']) {
    const launched = await launchOwned({ home: path.join(home, 'own'),
      owner: { session: 'reset-session', harness: 'claude-code', agent: { subagent } },
      command: process.execPath, args: testChildArgs(), folder: home });
    if (launched.status === 'tracked') children.push(launched.run);
    assert.equal(launched.status, 'tracked');
    if (launched.status !== 'tracked') throw new Error('untracked test child');
    runs.push(launched.run);
  }
  tools = createAgentTools({ folder: home, dataDir: path.join(home, 'pgdata'), env: { CLAUDE_CODE_SESSION_ID: 'stale-session' } });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();

  await tools.server.connect(serverSide);
  await client.connect(clientSide);
  const self = await client.callTool({ name: 'list_own_runs', arguments: {}, _meta: { 'claudecode/toolUseId': 'hook-call' } });
  assert.equal(self.isError, undefined, JSON.stringify(self));
  const inventory = (self.structuredContent as Record<string, unknown>).inventory as Awaited<ReturnType<typeof listRuns>>;
  assert.deepEqual(inventory.rows.map(row => row.run.id), [runs[0]!.id]);
  assert.equal(inventory.owner!.session, 'reset-session');
  await log.append(project, { session: 'reset-session', harness: 'claude-code', source: 'hook', folder: home,
    kind: 'tool-requested', tool: 'stop_own_run', call: 'stop-call', agent: { subagent: 'builder' } });
  const stopped = await client.callTool({ name: 'stop_own_run', arguments: { runs: runs.map(run => run.id) },
    _meta: { 'claudecode/toolUseId': 'stop-call' } });
  assert.equal(stopped.isError, true, JSON.stringify(stopped));
  assert.deepEqual(((stopped.structuredContent as Record<string, unknown>).result as { targets: { status: string }[] }).targets.map(row => row.status), ['stopped', 'refused']);
  const unresolved = await client.callTool({ name: 'list_own_runs', arguments: {}, _meta: { 'claudecode/toolUseId': 'not-recorded' } });
  assert.equal(unresolved.isError, true);
  assert.match(JSON.stringify(unresolved), /list_all_runs/);
});
