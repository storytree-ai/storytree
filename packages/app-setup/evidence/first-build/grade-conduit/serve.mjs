// Tiny static server for grading a Conduit frontend folder. No dependencies.
//
//   node serve.mjs --root <folder> [--port 0] [--host 127.0.0.1] [--port-file <path>]
//
// Resolution order for a GET/HEAD of /some/path:
//   1. the file itself (/some/path)
//   2. /some/path.html            ("clean URLs", for a multi-page app)
//   3. /some/path/index.html
//   4. SPA fallback: /index.html, but only for page navigations (no file extension
//      in the last segment, or an Accept header that asks for text/html). A missing
//      script, stylesheet or image stays a 404 so a broken asset path shows up.
// --port 0 picks a free port; the chosen port is written to --port-file (if given)
// and printed as "listening http://host:port".

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const root = path.resolve(args.root || '.');
const host = args.host || '127.0.0.1';
const port = Number(args.port || 0);

const types = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

function fileAt(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? p : null;
  } catch {
    return null;
  }
}

function resolve(urlPath, accept) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const abs = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // no escaping the root
  const direct = fileAt(abs) || fileAt(abs + '.html') || fileAt(path.join(abs, 'index.html'));
  if (direct) return direct;
  const last = rel.split('/').pop() || '';
  const isPage = !path.extname(last) || /text\/html/.test(accept || '');
  return isPage ? fileAt(path.join(root, 'index.html')) : null;
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0].split('#')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const file = resolve(urlPath, req.headers.accept);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  const actual = server.address().port;
  if (args['port-file']) fs.writeFileSync(args['port-file'], String(actual));
  console.log(`listening http://${host}:${actual} root=${root}`);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => server.close(() => process.exit(0)));
