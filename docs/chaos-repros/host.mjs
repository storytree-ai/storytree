// Manual drill host: the desktop's real Postgres owner, without Electron.
// Only an explicitly marked throwaway home under /tmp is accepted.
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { start } from '@storytree/local-postgres';

const home = realpathSync(process.env.STORYTREE_HOME || '/nonexistent');
if (!home.startsWith('/tmp/storytree-chaos.') || !existsSync(path.join(home, '.chaos-throwaway'))) {
  throw new Error('Requires /tmp/storytree-chaos.*/.chaos-throwaway');
}
const server = await start({ dataDir: path.join(home, 'pgdata'), owner: 'the storytree 0.3 desktop app', log: console.log });
writeFileSync(path.join(home, 'host.json'), JSON.stringify({ url: server.url, pid: process.pid }));
console.log(JSON.stringify({ ready: true, url: server.url, pid: process.pid }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setInterval(() => {}, 60_000);
