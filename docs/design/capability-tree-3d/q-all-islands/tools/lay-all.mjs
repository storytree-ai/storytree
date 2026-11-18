import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here);
const data = JSON.parse(readFileSync(path.join(dist, 'data.json'), 'utf8'));
const LIBRARY = 'story_754e87e7d531';
const asked = process.argv.slice(2);
const ids = (asked.length ? asked : Object.keys(data.stories));
const jobs = Number(process.env.JOBS ?? 3);
const one = id => new Promise(done => {
  const env = { ...process.env, STORY: id, ITER: process.env.ITER ?? '200', SEED: process.env.SEED ?? '43',
    ...(id === LIBRARY && !process.env.START ? { START: path.join(path.relative(process.cwd(), dist), 'layouts/round3.json'), ITER: process.env.LIB_ITER ?? '400' } : {}) };
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'layout.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  child.on('exit', code => { console.log(code === 0 ? out.trim() : `${data.stories[id].story.title}: failed\n${err.split('\n').filter(l => !l.startsWith('    at')).slice(0, 6).join('\n')}`); done(); });
});
const queue = [...ids];
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await one(queue.shift()); }));
