// Draws the first short's cast sprite sheet (ADR-1046 D1), pixel by pixel, no dependencies.
//
//   node packages/website/evidence/first-short/draw-cast.mjs [--preview out.png] [--scale 6]
//
// Writes ../../src/shorts/public/sprites/cast.png (RGBA, opaque or transparent pixels only) and
// cast.json (pose -> frames, prop -> rect). To add a pose: add a function to POSES below that
// returns frames (each a 48x56 Img built with `dev(...)`), add its fps, and re-run.
//
// Every sprite is rows of palette characters ('.' is transparent). The developer is composed of
// character-row parts (chair, legs, torso, head, neck) so that head, hair, shirt and chair stay
// identical across poses; arms are drawn with `limb`, a thick polyline that gets a 1-px outline.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '../../src/shorts/public/sprites')

// ---- palette (24 colours) --------------------------------------------------------------------
const PAL = {
  '.': null,
  o: '#08090d', // outline
  s: '#f0b48a', S: '#c98560', // skin, skin shade
  h: '#5a3626', H: '#8a5a3c', // hair, hair highlight
  t: '#e0813a', T: '#b25a28', // shirt, shirt shade
  p: '#34507a', P: '#243a5c', // jeans, jeans shade
  B: '#34335c', C: '#4d4c80', // chair navy, chair highlight (also city skyline)
  D: '#6a7280', E: '#424857', // metal light, metal dark (bezels, frames)
  F: '#8a4e30', G: '#6b3b26', I: '#472517', // walnut desk, three tones (I also coffee)
  J: '#3a8a9a', K: '#14323c', L: '#3ccf3c', // screen glow, screen dark, terminal green
  M: '#e4e4ea', N: '#9aa0ae', // paper white, grey bars / keys / shoes
  O: '#c0392b', // mug red, close dot
  Q: '#14203a', U: '#f2d06b', // night sky, lit window / moon
}
if (Object.keys(PAL).length - 1 > 24) throw new Error('palette over 24 colours')
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// ---- image ----------------------------------------------------------------------------------
class Img {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Array(w * h).fill('.') }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y * this.w + x] : '.' }
  stamp(rows, x0, y0, shift = () => 0) {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r[i] !== '.') this.set(x0 + i + shift(j), y0 + j, r[i])
    })
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c) }
  blit(src, x0, y0) { for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) if (src.get(i, j) !== '.') this.set(x0 + i, y0 + j, src.get(i, j)) }
  rows() { return Array.from({ length: this.h }, (_, j) => this.d.slice(j * this.w, (j + 1) * this.w).join('')) }
}
const fromRows = (rows) => {
  const w = rows[0].length
  rows.forEach((r, i) => { if (r.length !== w) throw new Error(`row ${i} is ${r.length} wide, expected ${w}: ${r}`) })
  const img = new Img(w, rows.length)
  img.stamp(rows, 0, 0)
  return img
}
const checkRows = (name, rows, w) => rows.forEach((r, i) => { if (r.length !== w) throw new Error(`${name} row ${i} is ${r.length} wide, expected ${w}: ${r}`) })
const rep = (c, n) => c.repeat(n)

// A thick polyline with a 1-px outline. The outline lands on transparent pixels as 'o'; where it
// would land on something already drawn it uses `soft` (if given) so an arm reads against the shirt.
// `w` is the stroke width in px (points are the top-left of each w x w stamp).
function limb(img, pts, fill, w, soft = null) {
  const cells = new Map()
  const seg = (a, b) => {
    let [x, y] = a
    const dx = Math.abs(b[0] - x), dy = Math.abs(b[1] - y), sx = x < b[0] ? 1 : -1, sy = y < b[1] ? 1 : -1
    let err = dx - dy
    for (;;) {
      for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) cells.set(`${x + i},${y + j}`, [x + i, y + j])
      if (x === b[0] && y === b[1]) break
      const e2 = 2 * err
      if (e2 > -dy) { err -= dy; x += sx }
      if (e2 < dx) { err += dx; y += sy }
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) seg(pts[i], pts[i + 1])
  const outline = []
  for (const [x, y] of cells.values()) for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!cells.has(`${x + ox},${y + oy}`)) outline.push([x + ox, y + oy])
  }
  for (const [x, y] of outline) {
    if (img.get(x, y) === '.') img.set(x, y, 'o')
    else if (soft) img.set(x, y, soft)
  }
  for (const [x, y] of cells.values()) img.set(x, y, fill)
}

// ---- developer parts ------------------------------------------------------------------------
const HEAD_X = 9, HEAD_Y = 6, TORSO_Y = 20

// Chair, 28 wide, placed at (0,18): backrest leaning back, seat, post, base, wheels (y=55 is the floor row).
const pad = (s, w = 28) => s.padEnd(w, '.')
const CHAIR = [
  ...Array(7).fill(pad('.oCBBo')),
  ...Array(7).fill(pad('..oCBBo')),
  ...Array(6).fill(pad('...oCBBo')),
  pad('...' + rep('o', 24)), // seat top outline (y=38)
  pad('...oCCCCCCCCCCCCCCCCCCCCCo'),
  pad('...oBBBBBBBBBBBBBBBBBBBBBo'),
  pad('...' + rep('o', 24)),
  ...Array(10).fill(pad('..............oDo')),
  pad('.....o' + rep('D', 19) + 'o'),
  pad('.....o' + rep('E', 19) + 'o'),
  pad('.....oEo.......oEo.......oEo'),
  pad('.....ooo.......ooo.......ooo'),
]
checkRows('CHAIR', CHAIR, 28)

// Thigh (placed at (9,32)), 25 wide x 7; its bottom outline doubles as the seat's top edge.
const THIGH = [
  '..' + rep('o', 21) + '..',
  '.o' + rep('p', 22) + 'o',
  '.o' + rep('p', 22) + 'o',
  '.o' + rep('P', 22) + 'o',
  '.o' + rep('P', 22) + 'o',
  '.o' + rep('P', 22) + 'o',
  '.' + rep('o', 23) + '.',
]
checkRows('THIGH', THIGH, 25)
// Shin (placed at (29,38)): jeans, then the sneaker down to the floor row.
const SHIN = [
  ...Array(15).fill('oppPo.....'), // y38..52
  'oNNNo.....',
  'oNNNNNNNo.',
  'ooooooooo.',
]
checkRows('SHIN', SHIN, 10)

// Torso (placed at (8,20)), 12 wide x 15; sheared per row so a lean keeps the hips planted.
const TORSO = [
  '..' + rep('o', 8) + '..',
  '.o' + 'TT' + rep('t', 6) + 'o.',
  ...Array(13).fill('o' + 'TT' + rep('t', 8) + 'o'),
]
checkRows('TORSO', TORSO, 12)

// Head (placed at (9,6) plus the pose offset), 14 wide x 12, facing right. The neck is drawn apart.
const HEAD = [
  '...oooooooo...',
  '..ohHHHhhhho..',
  '.ohHHhhhhhhho.',
  '.ohhhhhhhhhso.',
  '.ohhhhhhhhsso.',
  '.ohhhhhhhssso.',
  '.ohhhhssshhso.',
  '.ohhhhssssoso.',
  '.ohhhhSsssssso',
  '.ohhhhSsssSSo.',
  '..ohhssssssso.',
  '...ohsssssso..',
]
checkRows('HEAD', HEAD, 14)

// Expressions: pixel patches on the head (local coordinates).
const FACES = {
  neutral: [],
  up: [[10, 7, 's'], [10, 6, 'o'], [9, 6, 's']], // eyes raised, thinking
  closed: [[9, 7, 'o'], [10, 7, 'o'], [10, 9, 'S'], [11, 9, 'o'], [9, 9, 's']], // eyes shut, frown
  smile: [[9, 9, 'o'], [10, 10, 'o'], [11, 9, 'o'], [9, 8, 's']], // soft smile
  focus: [[10, 6, 'h'], [9, 6, 'h']], // lowered brow
}

const shiftFor = (lean) => (j) => Math.round((lean * (TORSO.length - 1 - j)) / (TORSO.length - 1))

function dev(p) {
  // p: lean, head [dx,dy], face, behind/front (drawing callbacks)
  const img = new Img(48, 56)
  img.stamp(CHAIR, 0, 18)
  img.stamp(SHIN, 29, 38)
  img.stamp(THIGH, 9, 32)
  const lean = p.lean ?? 0
  const [hx, hy] = p.head ?? [0, 0]
  const x0 = HEAD_X + lean + hx, y0 = HEAD_Y + hy
  if (p.behind) p.behind(img)
  // neck: from under the chin down into the shirt, outlined, shaded under the jaw
  for (let y = y0 + 11; y < TORSO_Y + 2; y++) {
    const c = y < y0 + 13 ? 'S' : 's'
    img.stamp(['o' + rep(c, 4) + 'o'], x0 + 4, y)
  }
  img.stamp(TORSO, 8, TORSO_Y, shiftFor(lean))
  const head = new Img(14, 12)
  head.stamp(HEAD, 0, 0)
  for (const [x, y, c] of FACES[p.face ?? 'neutral']) head.set(x, y, c)
  img.blit(head, x0, y0)
  if (p.front) p.front(img)
  return img
}

// Shoulder x for a given lean (torso row 3, y=23).
const sh = (lean) => 14 + shiftFor(lean)(3)

// An arm: shoulder -> elbow (sleeve), elbow -> hand (skin forearm), then a 4x3 hand.
function arm(img, lean, elbow, hand, far = false) {
  const s = [sh(lean) - (far ? 1 : 0), 23]
  limb(img, [s, elbow], far ? 'T' : 't', 3, 'T')
  limb(img, [elbow, hand], far ? 'S' : 's', 2)
  limb(img, [[hand[0] - 1, hand[1] - 1], [hand[0], hand[1] - 1]], far ? 'S' : 's', 3, 'o')
}

const POSES = {}

POSES.typing = { fps: 8, frames: [0, 1, 2, 3].map((i) => dev({
  lean: 1, head: [1, 0], face: 'focus',
  behind: (img) => arm(img, 1, [22, 32], [39, [30, 29, 28, 29][i]], true),
  front: (img) => arm(img, 1, [24, 31], [43, [29, 28, 29, 30][i]]),
})) }

POSES['typing-exact'] = { fps: 4, frames: [0, 1, 2].map((i) => dev({
  lean: 0, head: [0, 0], face: 'neutral',
  behind: (img) => arm(img, 0, [22, 32], [39, [30, 30, 29][i]], true),
  front: (img) => arm(img, 0, [24, 31], [43, [29, 29, 30][i]]),
})) }

POSES.thinking = { fps: 4, frames: [0, 1, 2].map((i) => dev({
  lean: -2, head: [-1, [0, -1, 0][i]], face: 'up',
  behind: (img) => arm(img, -2, [19, 30], [28, 31], true),
  front: (img) => {
    arm(img, -2, [21, 30], [15, [18, 17, 18][i]]) // hand on chin; fingers tap on the middle frame
    if (i === 1) { img.set(21, 9, 'M'); img.set(23, 6, 'M') } // a stray thought
  },
})) }

POSES.frustrated = { fps: 6, frames: [0, 1, 2].map((i) => dev({
  lean: 4, head: [3, 6], face: 'closed',
  front: (img) => {
    arm(img, 4, [21, 31], [23, [20, 19, 20][i]], true)
    arm(img, 4, [24, 31], [26, [18, 19, 18][i]])
    const d = [[31, 9], [32, 12], [32, 15]][i]
    img.set(d[0], d[1], 'J'); img.set(d[0], d[1] + 1, 'J')
  },
})) }

POSES.satisfied = { fps: 4, frames: [0, 1, 2].map((i) => dev({
  lean: -1, head: [0, [0, 1, 0][i]], face: 'smile',
  behind: (img) => arm(img, -1, [17, 30], [26, 31], true),
  front: (img) => {
    arm(img, -1, [19, 30], [29, 31])
    if (i === 1) { for (const [x, y] of [[25, 7], [24, 8], [26, 8], [25, 9]]) img.set(x, y, 'U') } // a small glint
  },
})) }

POSES.inspecting = { fps: 6, frames: [0, 1, 2].map((i) => dev({
  lean: 4, head: [1, 1], face: 'focus',
  behind: (img) => arm(img, 4, [26, 32], [40, 30], true),
  front: (img) => {
    img.rect(43, 31, 5, 1, 'N') // mouse
    img.rect(43, 32, 5, 1, 'E')
    arm(img, 4, [27, 31], [44, [29, 30, 29][i]])
    if (i === 1) { img.set(47, 26, 'U'); img.set(46, 24, 'U') } // click spark
  },
})) }

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

// ---- sheet assembly --------------------------------------------------------------------------
function build() {
  const poseNames = Object.keys(POSES)
  const props = { desk: desk(), monitor: monitor(), window: windowSprite(), document: documentSprite(), mug: MUG }
  const poseW = Math.max(...poseNames.map((n) => POSES[n].frames.length * 48))
  const propW = Object.values(props).reduce((a, p) => a + p.w, 0)
  const W = Math.max(poseW, propW), H = poseNames.length * 56 + 32
  const sheet = new Img(W, H)
  const map = { image: 'sprites/cast.png', width: W, height: H, poses: {}, props: {} }
  poseNames.forEach((n, row) => {
    map.poses[n] = { fps: POSES[n].fps, frames: [] }
    POSES[n].frames.forEach((f, i) => {
      sheet.blit(f, i * 48, row * 56)
      map.poses[n].frames.push({ x: i * 48, y: row * 56, w: 48, h: 56 })
    })
  })
  let x = 0
  const y = poseNames.length * 56
  for (const [n, img] of Object.entries(props)) {
    sheet.blit(img, x, y)
    map.props[n] = { x, y, w: img.w, h: img.h }
    x += img.w
  }
  return { sheet, map }
}

// ---- PNG -------------------------------------------------------------------------------------
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
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
function toRgba(img, scale = 1, bg = null) {
  const W = img.w * scale, H = img.h * scale, buf = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = img.get(Math.floor(x / scale), Math.floor(y / scale))
    const col = PAL[c] ? rgb(PAL[c]) : bg ? rgb(bg) : null
    const o = (y * W + x) * 4
    if (col) { buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255 }
  }
  return { W, H, buf }
}

const { sheet, map } = build()
mkdirSync(OUT, { recursive: true })
const o = toRgba(sheet)
writeFileSync(join(OUT, 'cast.png'), png(o.W, o.H, o.buf))
writeFileSync(join(OUT, 'cast.json'), JSON.stringify(map) + '\n')
console.log(`cast.png ${o.W}x${o.H}, poses: ${Object.keys(map.poses).join(', ')}, props: ${Object.keys(map.props).join(', ')}`)

const args = process.argv.slice(2)
const pi = args.indexOf('--preview')
if (pi >= 0) {
  const scale = Number(args[args.indexOf('--scale') + 1]) || 6
  const p = toRgba(sheet, scale, '#1b1f2b')
  writeFileSync(args[pi + 1], png(p.W, p.H, p.buf))
}
