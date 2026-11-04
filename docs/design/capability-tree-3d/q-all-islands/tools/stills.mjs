// Takes this folder's stills with look.mjs: port-rest, port-mouth, port-mouth-near and port-keys (and the same with a
// query, named by NAME). Run from the checkout root:
//   node docs/design/capability-tree-3d/q-all-islands/tools/stills.mjs [query] [view ...]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), stills = path.join(path.dirname(here), 'stills');
const [query = '', ...asked] = process.argv.slice(2);
const name = process.env.NAME ?? 'port';
const views = {
  rest: [{ wheel: 300, x: 720, y: 450, times: 5 }, { drag: [-120, -150], x: 860, y: 600 }],
  mouth: [{ grab: ['mouth', ''], to: [720, 450] }, { wheel: -300, x: 720, y: 450, times: 11 }],
  'mouth-near': [{ grab: ['mouth', ''], to: [720, 450] }, { wheel: -300, x: 720, y: 450, times: 16 }],
  keys: [{ grab: ['keys', ''], to: [720, 450] }, { wheel: -300, x: 720, y: 450, times: 11 }],
};
const one = view => new Promise(done => {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'look.mjs'), `${name}-${view}`, query, JSON.stringify(views[view]), '--retake'],
    { env: { ...process.env, LOOK_DIR: stills }, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', done);
});
await Promise.all((asked.length ? asked : Object.keys(views)).map(one));
