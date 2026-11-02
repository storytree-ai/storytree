// Writes data.js beside index.html from data.json, so the page opens from disk with no network (a file:// page may not
// fetch). Run from the checkout root after measure.mjs: node docs/design/capability-tree-3d/b-circuit/tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const dir = 'docs/design/capability-tree-3d/b-circuit/';
writeFileSync(dir + 'data.js', 'window.CAPTREE = ' + JSON.stringify(JSON.parse(readFileSync(dir + 'data.json', 'utf8'))) + ';\n');
console.log('wrote', dir + 'data.js');
