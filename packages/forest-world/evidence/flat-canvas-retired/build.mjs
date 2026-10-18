// Bundle this checkout's real desktop page with the shared capture observation seams: node build.mjs <before|after>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
await buildCapture({ root: path.resolve(here, '../../../..'), dist: path.join(here, 'dist', process.argv[2] ?? 'after') });
