import { readFileSync, writeFileSync } from 'node:fs';
const dir = 'docs/design/capability-tree-3d/b-circuit/';
writeFileSync(dir + 'data.js', 'window.CAPTREE = ' + JSON.stringify(JSON.parse(readFileSync(dir + 'data.json', 'utf8'))) + ';\n');
console.log('wrote', dir + 'data.js');
