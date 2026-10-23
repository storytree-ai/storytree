// Bundle a checkout's real desktop page with the shared capture observation seams.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.resolve(here, '../../../../../..'));
const label = process.argv[3] ?? 'after';
await buildCapture({ root, dist: buildFolder(here, label) });
