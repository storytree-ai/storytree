// The gear lane's real Electron route, without visual captures or CDP interaction.
// Run under the heavy lock, with DISPLAY and an isolated, restored STORYTREE_HOME.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
const args = ['desktop:smoke', '--project', 'storytree', '--screenshot', path.join(process.env.STORYTREE_HOME, 'smoke.png')];
if (process.platform === 'linux') {
  assert.ok(process.env.DISPLAY, 'a temporary X display is required');
  args.push('--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
}
const child = spawn('pnpm', args, { cwd: path.resolve(output, '../../../..'), env: process.env });
let log = '';
child.stdout.on('data', (chunk) => { log += String(chunk); });
child.stderr.on('data', (chunk) => { log += String(chunk); });
const [code] = await once(child, 'close');
writeFileSync(path.join(output, 'smoke.txt'), log);
assert.equal(code, 0, log);
assert.match(log, /smoke: project "storytree": .* and all \d+ capabilities/, 'the census must pass');
assert.doesNotMatch(log, /library is not open|Error occurred in handler|closing the projects:|closing the library:|stopping Postgres:/i,
  'a passing census must also finish without a teardown error');
console.log('PASS: native smoke census and teardown; complete log in smoke.txt');
