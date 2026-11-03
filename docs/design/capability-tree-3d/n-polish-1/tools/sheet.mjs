// Lays a before and an after still side by side, each cropped the same way, with a caption under each, into stills/.
// Run from the checkout root: node --import tsx docs/design/capability-tree-3d/n-polish-1/tools/sheet.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.dirname(here), stills = path.join(dist, 'stills');
/** name: [before file, its caption], [after file, its caption], the crop (a scale and the corner it keeps). */
const SHEETS = {
  'sheet-rest': [['before-rest.png', 'Before (the port mock, l-port): 25 marks overlapping'], ['after-rest.png', 'After: 8 overlapping'], { scale: 0.64, origin: '-40px -110px' }],
  'sheet-knot': [['before-knot.png', 'Before, round Library API'], ['after-knot.png', 'After, round Library API'], { scale: 0.8, origin: '0px 0px' }],
  'sheet-keys': [['before-keys-near.png', "Before: the way out kinks off Keys' port"], ['after-keys-near.png', 'After: straight out, then one easy turn'], { scale: 1.5, origin: '1110px 600px' }],
  'sheet-legend': [['before-rest.png', 'Before: purple roads, teal lanes'], ['after-rest.png', 'After: the sandy road, the sea-blue lane, open land'], { scale: 1.3, origin: '4723px 2405px' }],
  'sheet-other-ports': [['dropped-other-ports-before.png', 'As landed: lanes stop at the coast'], ['dropped-other-ports.png', 'Tried and dropped: a port where each lane lands'], { scale: 1.3, origin: '1647px 1213px' }],
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
