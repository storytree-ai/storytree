import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

// Execute the exact server declaration extracted from each pinned source file.
// Synthetic roots replace build outputs. Browser/capture startup is not executed.
const sources = [
  ['packages/website/evidence/terminal.mjs', false],
  ['packages/website/evidence/turn/capture.mjs', false],
  ['packages/website/evidence/journey/capture.mjs', false],
  ['packages/website/evidence/arrival/capture.mjs', false],
  ['packages/website/evidence/nameplates-phone/capture.mjs', false],
  ['packages/website/evidence/warm-globe/measure.mjs', false],
  ['packages/forest-world/evidence/flat-canvas-retired/capture-website.mjs', false],
  ['packages/website/evidence/capture.mjs', true],
];
const fixture = await mkdtemp('/work/capture-');
const dist = path.join(fixture, 'dist');
await mkdir(dist);
await mkdir(path.join(fixture, 'dist-extra'));
await writeFile(path.join(dist, 'index.html'), 'SYNTHETIC_INDEX');
await writeFile(path.join(dist, '404.html'), 'SYNTHETIC_NOT_FOUND');
await writeFile(path.join(fixture, 'marker.txt'), 'SYNTHETIC_ADJACENT_MARKER', { mode: 0o600 });
await writeFile(path.join(fixture, 'dist-extra', 'marker.txt'), 'SYNTHETIC_PREFIX_MARKER', { mode: 0o600 });
const fetchRaw = (port, target) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path: target, method: 'GET', agent: false }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', part => { body += part; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.setTimeout(2000, () => req.destroy(new Error('synthetic request timeout')));
  req.end();
});
try {
  for (const [source, guarded] of sources) {
    const text = await readFile(path.join('/repo', source), 'utf8');
    const declaration = text.match(/^const server = createServer\(async \(req, res\) => \{[\s\S]*?^\}\);/m)?.[0];
    assert.ok(declaration, `expected complete server declaration in ${source}`);
    // This extra fixture guard never narrows dist-vs-sibling behavior being tested.
    const syntheticRead = file => {
      assert.ok(path.resolve(file).startsWith(fixture + path.sep), 'no reads outside synthetic fixture');
      return readFile(file);
    };
    const server = vm.runInNewContext(declaration + '\nserver;', {
      createServer, URL, decodeURIComponent, path, dist, types: { '.html': 'text/html' }, readFile: syntheticRead,
    }, { filename: source, timeout: 1000 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      const normal = await fetchRaw(port, '/');
      const absent = await fetchRaw(port, '/marker.txt');
      const adjacent = await fetchRaw(port, '/%2e%2e%2fmarker.txt');
      const siblingPrefix = await fetchRaw(port, '/%2e%2e%2fdist-extra%2fmarker.txt');
      assert.deepEqual(normal, { status: 200, body: 'SYNTHETIC_INDEX' });
      assert.equal(absent.status, 404);
      assert.deepEqual(adjacent, guarded ? { status: 403, body: '' } : { status: 200, body: 'SYNTHETIC_ADJACENT_MARKER' });
      assert.deepEqual(siblingPrefix, guarded ? { status: 403, body: '' } : { status: 200, body: 'SYNTHETIC_PREFIX_MARKER' });
      console.log(JSON.stringify({ source, declarationSha256: createHash('sha256').update(declaration).digest('hex'), guarded, normal, absent, adjacent, siblingPrefix }));
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
} finally { await rm(fixture, { recursive: true, force: true }); }
