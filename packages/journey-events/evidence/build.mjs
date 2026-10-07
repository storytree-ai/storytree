// The desktop renderer the capture photographs, built alone: no browser, no pictures.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture } from '../../../apps/desktop/src/capture/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../../..');
export const build = (dist = path.join(root, '.pgtest/windows-health-successor/journey-renderer')) => buildCapture({ dist, root }).then(() => dist);
if (process.argv[1] === fileURLToPath(import.meta.url)) await build(process.argv[2]);
