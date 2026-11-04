// Where build.mjs puts the built page, and where the tools that open it serve it from. A build goes to the checkout's
// ignored .evidence-builds/ (the capture kit's buildFolder rule), so building leaves the committed index.html, page.js and
// page.css as they were; with --retake it rewrites the committed page itself and clears that build, so the tools serve
// the committed page again.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../../../..');
export const mock = path.dirname(here);
export const built = path.join(root, '.evidence-builds', path.relative(root, mock));
/** The folder to serve the page from: the last build's, else the committed page. */
export const pageFolder = () => existsSync(path.join(built, 'index.html')) ? built : mock;
