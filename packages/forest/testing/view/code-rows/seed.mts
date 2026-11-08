// Refreshes the committed snapshot of the real library for the capture's stand-in bridge, and its code survey: opens
// project "storytree" where routing says it is (as the command line does) and writes seed.json.gz (the same shape as
// ../knowledge-under-islands/seed.json, gzipped) and survey.json beside this script. Writes nothing to the library.
// Run: tsx seed.mts. A capture that only needs islands this snapshot lacks need not refresh it: the capture kit's
// seedHolding builds a fresh pair in a scratch folder (apps/desktop/src/capture/fresh-seed.ts).
// The change history is folded to keep the file small: each record keeps its `created` change and its last later
// change (story creation order, which places the islands, is unchanged); the cursor is kept.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshFromCheckout } from '../../../../../apps/desktop/src/capture/fresh-seed.ts';

const { seed } = await freshFromCheckout(path.dirname(fileURLToPath(import.meta.url)));
console.log(seed.tree.stories.length, seed.tree.stories.map(story => story.title));
