import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../../../..');
export const mock = path.dirname(here);
export const built = path.join(root, '.evidence-builds', path.relative(root, mock));
export const pageFolder = () => existsSync(path.join(built, 'index.html')) ? built : mock;
