// node --import tsx packages/website/evidence/first-short/polish-2/round.mjs <N> [--no-render]
// One round of the first short's polish loops (increment_ea834305fe2d's in ../polish, increment_fa48e88589f9's here): renders the cut (../render.mjs), then writes what the
// director is shown into ./round-N/: contact sheets of frames every 0.25 s plus the frames either side of every cut
// (contact-NN.png, each frame labelled with its time, a cut marked), a 960x540 still of every beat (beat-*.png) and the
// script's timing table (timing.md). The director's findings go beside them (findings.md). The director sees sampled
// frames only, never the motion between them.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { small } from "../../../src/shorts/font.ts";
import { rgbOf } from "../../../src/shorts/render.ts";
import { focusIn, SCRIPT } from "../../../src/shorts/scene.ts";
import { END_CARD, LENGTH, LOW, readingTime, SCALE } from "../../../src/shorts/script.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const round = Number(process.argv[2]);
if (!Number.isInteger(round) || round < 1) throw new Error("Name the round: round.mjs <N>");
const out = path.join(here, `round-${round}`);
mkdirSync(out, { recursive: true });
if (!process.argv.includes("--no-render")) execFileSync(process.execPath, ["--import", "tsx", path.join(here, "..", "render.mjs")], { stdio: "inherit" });
const video = path.join(here, "..", "seeing-what-agents-built-1080p.mp4");
const FPS = 30;

// ---- PNG out --------------------------------------------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) };
function png({ w, h, buf }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) buf.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const image = (w, h, fill = [16, 18, 24]) => { const buf = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) buf.set(fill, i * 3); return { w, h, buf } };
/** A frame of the cut at `seconds`, one pixel per block of `step` (4: the short's own 480x270; 2: 960x540). */
async function frameAt(seconds, step) {
  const rgb = await rgbOf(video, seconds), w = LOW.width * SCALE / step, h = LOW.height * SCALE / step, img = image(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.copy(img.buf, (y * w + x) * 3, ((y * step) * LOW.width * SCALE + x * step) * 3, ((y * step) * LOW.width * SCALE + x * step) * 3 + 3);
  return img;
}
const paste = (dst, src, x0, y0) => { for (let y = 0; y < src.h; y++) src.buf.copy(dst.buf, ((y0 + y) * dst.w + x0) * 3, y * src.w * 3, (y + 1) * src.w * 3) };
/** Words in the short's 3x5 screen font, each pixel `zoom` wide. */
function label(dst, text, x0, y0, colour, zoom = 2) {
  const rgb = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16));
  small({ set fillStyle(_) {}, fillRect: (x, y, w, h) => { for (let yy = y * zoom; yy < (y + h) * zoom; yy++) for (let xx = x * zoom; xx < (x + w) * zoom; xx++) if (xx < dst.w && yy < dst.h) dst.buf.set(rgb, (yy * dst.w + xx) * 3) } }, text, x0 / zoom, y0 / zoom, colour);
}

// ---- when to look ----------------------------------------------------------------------------
// A cut is where a half's picture changes: to or from a full view, to another app, or to another file; a new pose or thought
// inside one view is not a cut.
const cutsOf = beats => beats.filter((beat, i) => i > 0 && (beat.view !== beats[i - 1].view || beat.app !== beats[i - 1].app || beat.file !== beats[i - 1].file)).map(beat => beat.from);
const cuts = [...new Set(Object.values(SCRIPT).flatMap(cutsOf).concat(END_CARD))].filter(at => at > 0).sort((a, b) => a - b);
const times = new Map();
for (let t = 0; t < LENGTH; t += 0.25) times.set(Math.round(t * FPS), false);
for (const cut of cuts) for (const d of [-1, 0, 1]) times.set(Math.round(cut * FPS) + d, d === 0);
const frames = [...times].filter(([f]) => f >= 0 && f < LENGTH * FPS).sort((a, b) => a[0] - b[0]);

// ---- contact sheets: 4 x 5 frames a page, each 480x270 over a label strip -----------------------
const COLS = 4, ROWS = 5, CELL = { w: LOW.width + 6, h: LOW.height + 18 };
for (let page = 0; page * COLS * ROWS < frames.length; page++) {
  const sheet = image(COLS * CELL.w, ROWS * CELL.h);
  const on = frames.slice(page * COLS * ROWS, (page + 1) * COLS * ROWS);
  for (const [i, [frame, cut]] of on.entries()) {
    const x = (i % COLS) * CELL.w, y = Math.floor(i / COLS) * CELL.h;
    paste(sheet, await frameAt(frame / FPS, SCALE), x, y);
    label(sheet, `${(frame / FPS).toFixed(2)}s f${frame}${cut ? " cut" : ""}`, x + 2, y + LOW.height + 3, cut ? "#ffd34d" : "#c9ced8");
  }
  writeFileSync(path.join(out, `contact-${String(page + 1).padStart(2, "0")}.png`), png(sheet));
}

// ---- a still of every beat, mid-beat, at 960x540 ------------------------------------------------
const mids = [...new Set(Object.values(SCRIPT).flatMap(beats => beats.map(beat => Math.round((beat.from + beat.to) / 2 * FPS))))].concat(Math.round((END_CARD + LENGTH) / 2 * FPS)).sort((a, b) => a - b);
for (const frame of mids) writeFileSync(path.join(out, `beat-${(frame / FPS).toFixed(2).padStart(5, "0")}s.png`), png(await frameAt(frame / FPS, 2)));

// ---- the timing table -----------------------------------------------------------------------------
const rows = side => SCRIPT[side].map(beat => `| ${beat.from.toFixed(2)} | ${beat.to.toFixed(2)} | ${beat.view} | ${beat.app}${beat.file ? ` ${beat.file}` : ""} | ${beat.pose} | ${[beat.think && `thinks "${beat.think}"`, beat.typed && `types "${beat.typed.length > 60 ? `${beat.typed.slice(0, 57)}..." (${beat.typed.length} chars)` : `${beat.typed}"`}`, beat.reply && `Claude: "${beat.reply}"`, beat.clicks && "clicks the island, its panel opens"].filter(Boolean).join("; ")} |`).join("\n");
const held = [];
for (const side of Object.keys(SCRIPT)) {
  const open = new Map();
  for (let f = 0; f <= END_CARD * FPS; f++) {
    const now = new Set(f === END_CARD * FPS ? [] : focusIn(side, f / FPS).map(focus => focus.text));
    for (const [text, from] of open) if (!now.has(text)) { held.push({ side, text, from, to: f / FPS }); open.delete(text) }
    for (const text of now) if (!open.has(text)) open.set(text, f / FPS);
  }
}
writeFileSync(path.join(out, "timing.md"), `# Round ${round}: the script's timing

${LENGTH} s at ${FPS} fps; the end card from ${END_CARD} s. Cuts (a change of view, app or file; a new pose or thought inside one view is not a cut): left ${cutsOf(SCRIPT.without).map(c => c.toFixed(2)).join(", ")}; right ${cutsOf(SCRIPT.with).map(c => c.toFixed(2)).join(", ")}; the end card ${END_CARD.toFixed(2)}.

## Without storytree (left half)

| from | to | view | screen | pose | what happens |
| --- | --- | --- | --- | --- | --- |
${rows("without")}

## With storytree (right half)

| from | to | view | screen | pose | what happens |
| --- | --- | --- | --- | --- | --- |
${rows("with")}

## Lines a viewer must read, and how long each is held

Reading time is words / 2.5 + 1 s.

| half | line | shown from | to | held | needs |
| --- | --- | --- | --- | --- | --- |
${held.map(({ side, text, from, to }) => `| ${side} | ${text} | ${from.toFixed(2)} | ${to.toFixed(2)} | ${(to - from).toFixed(2)} | ${readingTime(text).toFixed(2)} |`).join("\n")}
`);
console.log(`round ${round}: ${frames.length} frames on ${Math.ceil(frames.length / COLS / ROWS)} contact sheets, ${mids.length} beat stills, timing.md`);
