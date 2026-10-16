// Assembles the first short's cast sprite sheet (ADR-1046 D1, ADR-1065): no network, no dependencies.
//
//   node packages/website/evidence/first-short/assemble-cast.mjs [--preview out.png] [--scale 6]
//
// The developer's frames are PixelLab's output (https://www.pixellab.ai, api v2), committed as they
// came back in ./pixellab/ (generations.json records every call that made them). This script only
// places them: each 48x48 PixelLab frame goes onto a 52x56 cell at (4, 8), so the wheels sit on the
// cell's bottom row (the floor), the hands reach the desk's keyboard and the head sits where the
// scene's bubbles point. The chair is the same pixels in every frame, so switching poses never jumps.
// The props (desk, monitor, mug, document, window) are still drawn here, pixel by pixel.
//
// Writes ../../src/shorts/public/sprites/cast.png (RGBA, opaque or transparent pixels only) and
// cast.json (pose -> frames, prop -> rect).
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '../../src/shorts/public/sprites')
const RAW = join(here, 'pixellab')

// ---- poses: which PixelLab frames (pixellab/<pose>-<n>.png) play, in order -------------------
const CELL = { w: 52, h: 56 }, AT = { x: 4, y: 8 }
const POSES = {
  typing: { fps: 8, play: [0, 1, 2, 1] },
  'typing-exact': { fps: 4, play: [0, 1] },
  thinking: { fps: 4, play: [1, 2] },
  frustrated: { fps: 6, play: [0, 1, 2, 1] },
  satisfied: { fps: 4, play: [0, 1, 2, 3] },
  inspecting: { fps: 6, play: [1, 2, 3, 2] },
}

// ---- palette of the props (the developer brings PixelLab's own colours) ----------------------
const PAL = {
  '.': null,
  o: '#08090d', // outline
  B: '#34335c', // city skyline
  D: '#6a7280', E: '#424857', // metal light, metal dark (bezels, frames)
  F: '#8a4e30', G: '#6b3b26', I: '#472517', // walnut desk, three tones (I also coffee)
  J: '#3a8a9a', K: '#14323c', L: '#3ccf3c', // screen glow, screen dark, terminal green
  M: '#e4e4ea', N: '#9aa0ae', // paper white, grey bars / keys / shoes
  O: '#c0392b', // mug red, close dot
  Q: '#14203a', U: '#f2d06b', // night sky, lit window / moon
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// ---- prop canvas -----------------------------------------------------------------------------
class Img {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Array(w * h).fill('.') }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y * this.w + x] : '.' }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c) }
}
const fromRows = (rows) => {
  const w = rows[0].length
  rows.forEach((r, i) => { if (r.length !== w) throw new Error(`row ${i} is ${r.length} wide, expected ${w}: ${r}`) })
  const img = new Img(w, rows.length)
  rows.forEach((r, j) => { for (let i = 0; i < w; i++) img.set(i, j, r[i]) })
  return img
}
const rep = (c, n) => c.repeat(n)

// ---- props -----------------------------------------------------------------------------------
function desk() {
  const rows = []
  const w = 100
  const wrap = (s) => { if (s.length !== w) throw new Error('desk row ' + s.length); return s }
  rows.push(wrap(rep('F', w))) // y0 lit edge
  for (let y = 1; y < 4; y++) rows.push(wrap(rep('G', w)))
  rows.push(wrap(rep('o', w))) // y4 front edge
  rows.push(wrap(rep('I', w))) // y5 apron
  for (let y = 6; y < 26; y++) {
    const r = Array(w).fill('.')
    const putLeg = (x) => { r[x] = 'o'; r[x + 1] = 'F'; r[x + 2] = 'G'; r[x + 3] = 'G'; r[x + 4] = 'o' }
    putLeg(10)
    if (y >= 6 && y < 25) { // drawer pedestal on the right
      for (let x = 70; x < 96; x++) r[x] = x === 70 || x === 95 ? 'o' : 'G'
      if (y === 6 || y === 24) for (let x = 70; x < 96; x++) r[x] = 'o'
      if (y === 15) for (let x = 71; x < 95; x++) r[x] = 'o'
      if (y === 10 || y === 20) for (let x = 82; x < 85; x++) r[x] = 'N'
      if ((y >= 7 && y < 15) || (y >= 16 && y < 24)) for (let x = 71; x < 95; x++) if (r[x] === 'G') r[x] = y % 9 === 7 ? 'F' : 'G'
    }
    if (y === 25) { for (let x = 70; x < 96; x++) r[x] = 'o' ; r[10] = r[14] = 'o'; for (let x = 11; x < 14; x++) r[x] = 'o' }
    rows.push(r.join(''))
  }
  const img = fromRows(rows)
  // Keyboard on the left end of the top: y0..2, x3..19.
  for (let i = 0; i < 17; i++) {
    img.set(3 + i, 0, i % 2 ? 'E' : 'N')
    img.set(3 + i, 1, 'N')
    img.set(3 + i, 2, 'E')
  }
  img.set(2, 0, 'o'); img.set(20, 0, 'o'); img.set(2, 1, 'o'); img.set(20, 1, 'o'); img.set(2, 2, 'o'); img.set(20, 2, 'o')
  return img
}

function monitor() {
  const img = new Img(30, 26)
  img.rect(0, 0, 30, 19, 'o')
  img.rect(1, 1, 28, 17, 'D')
  img.rect(1, 17, 28, 1, 'E')
  img.rect(3, 3, 24, 13, 'K') // screen
  // screen glow: bright rim, then terminal lines
  for (let x = 3; x < 27; x++) { img.set(x, 3, 'J') }
  for (let y = 3; y < 16; y++) { img.set(3, y, 'J'); img.set(26, y, 'J') }
  for (let x = 3; x < 27; x++) img.set(x, 15, 'J')
  const lines = [[5, 5, 7], [9, 5, 12], [5, 7, 4], [8, 7, 9], [5, 9, 10], [5, 11, 6], [12, 11, 8], [5, 13, 3]]
  for (const [x, y, l] of lines) for (let i = 0; i < l; i++) img.set(x + i, y, 'L')
  img.set(25, 17, 'L') // power light
  img.rect(12, 19, 6, 4, 'o'); img.rect(13, 19, 4, 4, 'D'); img.rect(16, 19, 1, 4, 'E')
  img.rect(7, 23, 16, 3, 'o'); img.rect(8, 23, 14, 2, 'D'); img.rect(8, 24, 14, 1, 'E')
  return img
}

const MUG = fromRows([
  '.oooo..',
  'oIIIIo.',
  'oOMOOoo',
  'oOMOO.o',
  'oOOOO.o',
  'oOOOOoo',
  'oOOOOo.',
  '.oooo..',
])

function documentSprite() {
  const img = new Img(40, 30)
  img.rect(0, 0, 40, 30, 'o')
  img.rect(1, 1, 38, 28, 'M')
  img.rect(1, 1, 38, 5, 'E') // title bar
  img.rect(3, 2, 3, 3, 'O') // close dot
  img.rect(8, 3, 14, 1, 'N') // title text
  img.rect(1, 6, 38, 1, 'o')
  const bars = [[3, 9, 30], [3, 12, 34], [3, 15, 22], [3, 18, 32], [3, 21, 28], [3, 24, 14]]
  for (const [x, y, l] of bars) img.rect(x, y, l, 2, 'N')
  return img
}

function windowSprite() {
  const img = new Img(40, 32)
  img.rect(0, 0, 40, 32, 'o')
  img.rect(1, 1, 38, 30, 'E') // frame
  img.rect(3, 3, 34, 24, 'Q') // sky
  // skyline silhouettes with lit windows
  const bld = [[3, 17, 7, 10], [10, 13, 6, 14], [16, 19, 8, 8], [24, 11, 6, 16], [30, 16, 7, 11]]
  for (const [x, y, w, h] of bld) img.rect(x, y, w, h, 'B')
  const lit = [[4, 19], [7, 22], [11, 15], [13, 18], [12, 23], [18, 22], [21, 24], [25, 13], [27, 17], [26, 22], [32, 19], [34, 23], [4, 24]]
  for (const [x, y] of lit) img.set(x, y, 'U')
  // moon (crescent) top right
  img.rect(30, 5, 4, 4, 'M'); img.rect(31, 4, 2, 1, 'M'); img.rect(31, 9, 2, 1, 'M'); img.rect(32, 5, 2, 3, 'Q'); img.set(13, 6, 'M'); img.set(7, 9, 'M'); img.set(22, 5, 'M')
  // mullions and sill
  img.rect(19, 3, 2, 24, 'E'); img.rect(3, 14, 34, 1, 'E')
  img.rect(0, 27, 40, 5, 'o'); img.rect(0, 28, 40, 3, 'D'); img.rect(1, 30, 38, 1, 'E')
  return img
}

// ---- RGBA buffers ----------------------------------------------------------------------------
const rgba = (w, h) => ({ w, h, buf: Buffer.alloc(w * h * 4) })
function paint(dst, img, x0, y0) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const c = PAL[img.get(x, y)]
    if (!c) continue
    const o = ((y0 + y) * dst.w + x0 + x) * 4, [r, g, b] = rgb(c)
    dst.buf[o] = r; dst.buf[o + 1] = g; dst.buf[o + 2] = b; dst.buf[o + 3] = 255
  }
}
function copy(dst, src, x0, y0) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const s = (y * src.w + x) * 4
    if (src.buf[s + 3] < 128) continue // PixelLab's alpha is 0 or 255; keep the sheet binary
    const o = ((y0 + y) * dst.w + x0 + x) * 4
    src.buf.copy(dst.buf, o, s, s + 3); dst.buf[o + 3] = 255
  }
}

// ---- PNG in (8-bit RGBA, non-interlaced: what PixelLab returns) and out ----------------------
function readPng(file) {
  const d = readFileSync(file)
  let p = 8, w = 0, h = 0, idat = []
  while (p < d.length) {
    const len = d.readUInt32BE(p), type = d.toString('ascii', p + 4, p + 8), body = d.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4)
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error(`${file}: expected 8-bit RGBA, non-interlaced`)
    } else if (type === 'IDAT') idat.push(body)
    p += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat)), out = rgba(w, h), stride = w * 4
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out.buf[y * stride + i - 4] : 0, b = y ? out.buf[(y - 1) * stride + i] : 0
      const c = i >= 4 && y ? out.buf[(y - 1) * stride + i - 4] : 0
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]
      out.buf[y * stride + i] = (line[i] + pred) & 0xff
    }
  }
  return out
}
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png({ w, h, buf }) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; buf.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ---- sheet assembly --------------------------------------------------------------------------
function build() {
  const names = Object.keys(POSES)
  const props = { desk: desk(), monitor: monitor(), window: windowSprite(), document: documentSprite(), mug: MUG }
  const unique = (n) => [...new Set(POSES[n].play)]
  const poseW = Math.max(...names.map((n) => unique(n).length * CELL.w))
  const propW = Object.values(props).reduce((a, p) => a + p.w, 0)
  const propH = Math.max(...Object.values(props).map((p) => p.h))
  const sheet = rgba(Math.max(poseW, propW), names.length * CELL.h + propH)
  const map = { image: 'sprites/cast.png', width: sheet.w, height: sheet.h, poses: {}, props: {} }
  names.forEach((n, row) => {
    const cells = new Map()
    unique(n).forEach((frame, col) => {
      const src = readPng(join(RAW, `${n}-${frame}.png`))
      if (src.w + AT.x > CELL.w || src.h + AT.y > CELL.h) throw new Error(`${n}-${frame}.png is ${src.w}x${src.h}, too big for the cell`)
      copy(sheet, src, col * CELL.w + AT.x, row * CELL.h + AT.y)
      cells.set(frame, { x: col * CELL.w, y: row * CELL.h, w: CELL.w, h: CELL.h })
    })
    map.poses[n] = { fps: POSES[n].fps, frames: POSES[n].play.map((frame) => cells.get(frame)) }
  })
  let x = 0
  const y = names.length * CELL.h
  for (const [n, img] of Object.entries(props)) {
    paint(sheet, img, x, y)
    map.props[n] = { x, y, w: img.w, h: img.h }
    x += img.w
  }
  return { sheet, map }
}

const { sheet, map } = build()
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'cast.png'), png(sheet))
writeFileSync(join(OUT, 'cast.json'), JSON.stringify(map) + '\n')
console.log(`cast.png ${sheet.w}x${sheet.h}, poses: ${Object.keys(map.poses).join(', ')}, props: ${Object.keys(map.props).join(', ')}`)

const args = process.argv.slice(2)
const pi = args.indexOf('--preview')
if (pi >= 0) {
  const scale = Number(args[args.indexOf('--scale') + 1]) || 6, bg = rgb('#1b1f2b')
  const p = rgba(sheet.w * scale, sheet.h * scale)
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const s = (Math.floor(y / scale) * sheet.w + Math.floor(x / scale)) * 4, o = (y * p.w + x) * 4
    if (sheet.buf[s + 3]) sheet.buf.copy(p.buf, o, s, s + 4)
    else { p.buf[o] = bg[0]; p.buf[o + 1] = bg[1]; p.buf[o + 2] = bg[2]; p.buf[o + 3] = 255 }
  }
  writeFileSync(args[pi + 1], png(p))
}
