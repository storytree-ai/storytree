// Minimal newline JSON-RPC client for the real stdio executable, not an MCP simulator.
import { child } from './common.mjs';

export async function mcp(folder, session) {
  const running = child('packages/agent-link/src/bins/storytree-mcp.ts', [], folder,
    { CLAUDE_PROJECT_DIR: folder, CLAUDE_CODE_SESSION_ID: session });
  const pending = new Map();
  let next = 1, buffer = '';
  running.proc.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const at = buffer.indexOf('\n');
      if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined) pending.get(message.id)?.(message);
    }
  });
  const send = message => running.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  function request(method, params) {
    const id = next++;
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Probe deadline (10s), not product deadline: ' + method)); }, 10_000);
      pending.set(id, message => {
        clearTimeout(timer); pending.delete(id);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      });
      send({ id, method, params });
    });
    answer.requestId = id;
    return answer;
  }
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: 'chaos-probe' } });
  send({ method: 'notifications/initialized' });
  return { ...running, call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    cancel: answer => send({ method: 'notifications/cancelled', params: { requestId: answer.requestId, reason: 'manual chaos cancellation before write' } }),
    stop: async () => { running.proc.kill('SIGTERM'); return running.done; } };
}
