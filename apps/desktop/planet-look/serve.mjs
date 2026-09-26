import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./dist/', import.meta.url));
createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname;
  if (!['/', '/index.html', '/scene.js', '/scene.js.map', '/forests.json'].includes(file)) {
    res.writeHead(404).end(); return;
  }
  try {
    const body = await readFile(root + (file === '/' ? 'index.html' : file.slice(1)));
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'text/html');
    res.end(body);
  } catch (error) { res.writeHead(500).end(String(error)); }
}).listen(4178, '127.0.0.1', () => console.log('planet look: http://127.0.0.1:4178'));
