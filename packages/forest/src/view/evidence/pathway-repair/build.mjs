// Bundle the real desktop; the shared kit adds only its existing observation seams.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.resolve(here, '../../../../../..'));
await buildCapture({ root, dist: path.join(here, 'dist', process.argv[3] ?? 'after') });
