// Bundle this checkout's real desktop page with the shared capture observation seams: node build.mjs <before|after>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder } from '../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
await buildCapture({ root: path.resolve(here, '../../../..'), dist: buildFolder(here, process.argv[2] ?? 'after') });
