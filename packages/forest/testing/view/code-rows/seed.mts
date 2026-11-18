import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshFromCheckout } from '../../../../../apps/desktop/src/capture/fresh-seed.ts';

const { seed } = await freshFromCheckout(path.dirname(fileURLToPath(import.meta.url)));
console.log(seed.tree.stories.length, seed.tree.stories.map(story => story.title));
