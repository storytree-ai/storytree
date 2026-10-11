// Summarises a probe's frames: per frame, the highest fill opacity of any shown territory, and how many borders are part-drawn.
// node summarize.mjs website-frames-before.json
import { readFile } from "node:fs/promises";
const frames = JSON.parse(await readFile(process.argv[2], "utf8"));
const t0 = frames[0]?.t ?? 0;
let flashes = 0;
const rows = frames.map(({ t, marks }) => {
  const fills = Object.entries(marks).filter(([k, m]) => k.includes("/territory:") && m.shown).map(([, m]) => m.opacity);
  const borders = Object.entries(marks).filter(([k, m]) => k.endsWith("/territory-borders") && m.shown);
  const top = fills.length ? Math.max(...fills) : 0;
  if (top > 0) flashes++;
  return `${String(t - t0).padStart(5)} ms  fill max ${top.toFixed(3)}  borders ${borders.length} (tracing ${borders.filter(([, m]) => m.drawn !== undefined).length})`;
});
console.log(rows.join("\n"));
console.log(`${frames.length} frames; ${flashes} with a filled territory shown (the step shows territories plain: any is a flash)`);
