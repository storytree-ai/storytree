// Copies data.json into index.html's data block, so the page opens from disk with no fetch.
// Run from the checkout root: node docs/design/capability-tree-medieval/e-diorama/tools/embed.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'docs/design/capability-tree-medieval/e-diorama/';
const data = JSON.stringify(JSON.parse(readFileSync(dir + 'data.json', 'utf8')));
const page = readFileSync(dir + 'index.html', 'utf8');
const block = /(<script id="data" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!block.test(page)) throw new Error('index.html has no data block');
writeFileSync(dir + 'index.html', page.replace(block, (_, open, close) => `${open}\n${data.replace(/</g, '\\u003c')}\n${close}`));
console.log('data embedded');
