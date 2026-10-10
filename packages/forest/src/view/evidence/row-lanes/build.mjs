// Bundle a checkout's real desktop page with the shared capture observation seams: <root> <before|after>.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.resolve(here, '../../../../../..'));
const label = process.argv[3] ?? 'after';
await buildCapture({ root, dist: path.join(here, 'dist', label) });
