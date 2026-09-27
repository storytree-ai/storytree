// Isolated local acceptance of the real Claude Code/Codex CLI formats; no agent sessions/model calls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectAgents, disconnectAgents, installedToolServerCommand } from '../../src/connect/index.ts';

const home = mkdtempSync(path.join(tmpdir(), 'storytree native connection '));
try {
  const claude = path.join(home, 'claude');
  const codex = path.join(home, 'codex');
  mkdirSync(claude); mkdirSync(codex);
  const tools = path.join(home, 'installed tools'); mkdirSync(tools);
  const server = path.join(tools, 'storytree-mcp.mjs'); writeFileSync(server, '// launch path fixture\n');
  const installed = installedToolServerCommand(process.execPath, server);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
  const options = { home, env, installed, harnesses: ['claude-code', 'codex'] };
  const claudeFile = path.join(claude, '.claude.json');
  const codexFile = path.join(codex, 'config.toml');
  const originalClaude = { theme: 'kept', mcpServers: { old02: { command: 'storytree02' }, other: { type: 'http', url: 'https://example.test/mcp' } } };
  const originalCodex = '# keep this comment\nmodel = "kept"\n[mcp_servers.old02]\ncommand = "storytree02"\n[mcp_servers.other]\nurl = "https://example.test/mcp"\n';
  writeFileSync(claudeFile, JSON.stringify(originalClaude)); writeFileSync(codexFile, originalCodex);
  assert.deepEqual((await connectAgents(options)).map(r => r.tools), ['connected', 'connected']);
  const registered = [readFileSync(claudeFile, 'utf8'), readFileSync(codexFile, 'utf8')];
  assert.deepEqual((await connectAgents(options)).map(r => r.tools), ['already connected', 'already connected']);
  assert.deepEqual([readFileSync(claudeFile, 'utf8'), readFileSync(codexFile, 'utf8')], registered);
  assert.ok(registered[1].startsWith(originalCodex));
  assert.deepEqual((await disconnectAgents(options)).harnesses.map(r => r.tools), ['disconnected', 'disconnected']);
  assert.deepEqual(JSON.parse(readFileSync(claudeFile, 'utf8')), originalClaude);
  assert.equal(readFileSync(codexFile, 'utf8').replace(/\n+/g, '\n'), originalCodex);
  writeFileSync(codexFile, '[mcp_servers.storytree\n');
  const invalid = await connectAgents(options);
  assert.deepEqual(invalid.map(r => r.tools), ['connected', 'not connected']);
  assert.equal(readFileSync(codexFile, 'utf8'), '[mcp_servers.storytree\n');
  console.log('PASS: real CLI formats, paths with spaces, preservation, repeat, independent invalid-TOML recovery and removal. No agent session or Windows artifact exercised.');
} finally { rmSync(home, { recursive: true, force: true }); }
