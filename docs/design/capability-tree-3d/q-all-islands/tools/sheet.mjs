// Lays a before and an after still side by side, each cropped the same way, with a caption under each, into stills/.
// Rollout 1: The library, polish round 3 as landed beside this round on round 3's open work (islands.mjs lib-r3-after).
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/sheet.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here), stills = path.join(dist, 'stills');
/** name: [before file, its caption], [after file, its caption], the crop (a scale and the corner it keeps). */
const SHEETS = {
  library: [['../../p-polish-3/stills/after-rest.png', 'Polish round 3 as landed (its snapshot): 3 overlapping, 8 within 4 px, 34 gates'], ['islands/lib-r3-after/story_754e87e7d531-rest.png', 'This round, on round 3\'s open work: 1 overlapping, 8 within 4 px, 32 gates'], { scale: 0.64, origin: '-40px -110px' }],
};
await withCapture({ folder: stills, dist }, async ({ browser, out }) => {
  const img = file => `data:image/png;base64,${readFileSync(path.join(stills, file)).toString('base64')}`;
  for (const [name, [a, b, crop]] of Object.entries(SHEETS)) {
    const p = await browser.newPage({ viewport: { width: 1440, height: 520 }, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0;background:#0e1418;color:#e8eef0;font:600 14px system-ui;display:flex;gap:10px;padding:10px">
      ${[a, b].map(([f, t]) => `<figure style="margin:0"><div style="width:705px;height:470px;overflow:hidden"><img src="${img(f)}" style="width:1440px;transform:scale(${crop.scale});transform-origin:${crop.origin}"></div><figcaption style="padding-top:6px">${t}</figcaption></figure>`).join('')}</body>`);
    await p.screenshot({ path: path.join(out, `${name}.png`) });
    await p.close();
    console.error(`took ${name}.png`);
  }
});
