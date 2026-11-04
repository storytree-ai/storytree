// Lays a before and an after still side by side, each cropped the same way, with a caption under each, into stills/.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/o-polish-2/tools/sheet.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here), stills = path.join(dist, 'stills');
/** name: [before file, its caption], [after file, its caption], the crop (a scale and the corner it keeps). */
const SHEETS = {
  'sheet-rest': [['before-rest.png', 'Before (polish round 1): 8 marks overlapping, 15 within 4 px'], ['after-rest.png', 'After: 5 overlapping, 11 within 4 px'], { scale: 0.64, origin: '-40px -110px' }],
  'sheet-mouth': [['before-mouth-near.png', 'Before: five roads fan across the open land, each up its own ramp'], ['after-mouth-near.png', 'After: one road climbs off it, then parts on the plateau'], { scale: 1.25, origin: '3000px 1000px' }],
  'sheet-knot': [['before-knot.png', 'Before, round Library API: 4 overlapping'], ['after-knot.png', 'After, round Library API: 1 overlapping'], { scale: 0.8, origin: '0px 0px' }],
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
