// Takes this folder's stills with look.mjs, two options at a time: <key>-rest, <key>-mouth, <key>-mouth-near and <key>-keys.
// Run from the checkout root: node docs/design/capability-tree-3d/i-sea-lanes/c-cable/tools/stills.mjs [key ...]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), stills = path.join(path.dirname(here), 'stills');
const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['station', 'gap'];
const views = {
  rest: [{ wheel: 300, x: 544, y: 450, times: 5 }, { drag: [-120, -150], x: 700, y: 600 }],
  mouth: [{ grab: ['mouth', ''], to: [544, 450] }, { wheel: -300, x: 544, y: 450, times: 11 }],
  'mouth-near': [{ grab: ['mouth', ''], to: [544, 450] }, { wheel: -300, x: 544, y: 450, times: 16 }],
  keys: [{ grab: ['keys', ''], to: [544, 450] }, { wheel: -300, x: 544, y: 450, times: 11 }],
};
const one = (key, view) => new Promise(done => {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'look.mjs'), `${key}-${view}`, `?sea=${key}`, JSON.stringify(views[view]), '--retake'],
    { env: { ...process.env, LOOK_DIR: stills }, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', done);
});
// VIEWS=rest,keys takes only those views.
const wanted = process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(views);
await Promise.all(keys.map(async key => { for (const view of wanted) await one(key, view); }));
