// Bundle a checkout's real desktop page with the shared capture observation seams: `node --import tsx build.mjs <checkout> before|after`.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.resolve(here, '../../../..'));
const dist = buildFolder(here, process.argv[3] ?? 'after');
await buildCapture({ root, dist });
// The page names no territory worker, so each island draws its start arrangement at once: with one, an island draws no
// territories until its search lands (forest 3.95), minutes an island, and the traversal's subject is not that layout.
const page = path.join(dist, 'index.html');
writeFileSync(page, readFileSync(page, 'utf8').replace(/\s*<meta name="storytree-territory-worker"[^>]*>/, ''));
