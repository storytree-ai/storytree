// Copies data.json into the page, so index.html opens from disk with no network and no second file.
// Run from the checkout root: node docs/design/capability-tree-medieval/d-ink-map/tools/inline.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'docs/design/capability-tree-medieval/d-ink-map/';
const page = readFileSync(dir + 'index.html', 'utf8');
const data = readFileSync(dir + 'data.json', 'utf8').trim().replaceAll('</', '<\\/');
const block = /(<script id="data" type="application\/json">\n)[\s\S]*?(\n<\/script>)/;
if (!block.test(page)) throw new Error('index.html has no data block');
writeFileSync(dir + 'index.html', page.replace(block, (_, open, close) => open + data + close));
