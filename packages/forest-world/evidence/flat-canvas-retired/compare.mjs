// Pixel-compare two captures, decoded in the capture kit's Chromium: node --import tsx compare.mjs <a.png> <b.png> [diff.png].
// Prints the pixels that differ at all, those off by more than 8 of 255 in any channel, and the largest difference.
import { readFileSync, writeFileSync } from 'node:fs';
import { launch } from '../../../../apps/desktop/src/capture/index.ts';
const [a, b, out] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage();
const result = await page.evaluate(async ([x, y, wantDiff]) => {
  const pixels = async base64 => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const [p, q] = await Promise.all([pixels(x), pixels(y)]);
  if (p.width !== q.width || p.height !== q.height) return { error: `sizes differ: ${p.width}x${p.height} vs ${q.width}x${q.height}` };
  const diff = new ImageData(p.width, p.height);
  let differing = 0, over8 = 0, maxChannel = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(p.data[i + c] - q.data[i + c]));
    if (d) differing++;
    if (d > 8) over8++;
    maxChannel = Math.max(maxChannel, d);
    diff.data[i] = d ? 255 : 0; diff.data[i + 3] = 255;
  }
  let png;
  if (wantDiff) {
    const canvas = new OffscreenCanvas(p.width, p.height); canvas.getContext('2d').putImageData(diff, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
    png = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  }
  return { pixels: p.width * p.height, differing, over8, maxChannel, png };
}, [readFileSync(a).toString('base64'), readFileSync(b).toString('base64'), !!out]);
await browser.close();
if (result.error) throw new Error(result.error);
if (out) writeFileSync(out, Buffer.from(result.png, 'base64'));
delete result.png;
console.log(JSON.stringify({ a, b, ...result }));
