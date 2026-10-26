// Assembles the first short's cast sprite sheet (ADR-1046 D1, ADR-1065): no network, no dependencies.
//
//   node packages/website/shorts/first-short/assemble-cast.mjs [--preview out.png] [--scale 4]
//
// The developer is PixelLab's (https://www.pixellab.ai, api v2), seen from behind at his desk as in
// the owner's reference (reference/first-short-reference-2026-10-18.png). His frames are committed as
// they came back in ./pixellab/, and generations.json records every call that made them. This script
// only places them, each on a 128x128 cell: the 80x96 seated frames at (48, 32), so they line up with
// the standing-up frames PixelLab drew on a 128x128 canvas from the same keyframe. Output 0 of every
// animation is PixelLab's echo of its first frame.
//
// None of his poses is frustrated (the owner, 2026-10-19: "don't show the dev frustrated at all"): he
// types, reads with his chin on his fist, or leans back with his hands behind his head. Leaning back
// and standing up play once and hold their last frame.
//
// Standing up plays PixelLab's frames 0-4, his rise out of the chair. From its fourth (frame 3) he is
// clear of the chair, so those frames keep only his columns (left of 72) and the scene draws the empty
// chair apart (columns 73 and right of the last frame), rolling back as he rises. His walk out is
// columns left of 72 of frames 6 and 7, the second shifted so both start at the same column, turned to
// face right.
//
// The room is PixelLab's too (increment_fa48e88589f9): the desk set of increment_ea834305fe2d (the
// owner's reference re-drawn without him and the chair, its screen one flat green: set.png) kept as it
// is at (0, 72) of a 240x256 half, and the rest of the room (walls, a window, a bed, the floor)
// inpainted round it (room.png). This script cuts its green screen out, so the scene draws what the
// screen shows behind the room and it shows through on exactly those pixels.
//
// Writes ../../src/shorts/public/sprites/cast.png (RGBA, opaque or transparent pixels only) and
// cast.json (pose -> frames, prop -> rect). What the screen shows is drawn by the scene in code
// (src/shorts/scene.ts).
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '../../src/shorts/public/sprites')
const RAW = join(here, 'pixellab')
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const CELL = 128, SEATED_AT = { x: 48, y: 32 }, CHAIR_FROM = 73
/** The room's one green, where its screen is. */
const GREEN = [94, 238, 86]

// ---- poses: which PixelLab frames (pixellab/<file>-<n>.png) play, in order -------------------
const POSES = {
  typing: { fps: 8, file: 'typing', play: [1, 2, 3, 4] },
  reading: { fps: 3, file: 'reading', play: [2, 3, 4, 3] },
  leaning: { fps: 5, file: 'leaning-back', play: [1, 3, 4], once: true },
  standing: { fps: 5, file: 'standing', play: [0, 1, 2, 3, 4], once: true, chairApart: 3 },
}
const WALK = { fps: 6, file: 'standing', play: [6, 7] }

// ---- RGBA buffers ----------------------------------------------------------------------------
const rgba = (w, h) => ({ w, h, buf: Buffer.alloc(w * h * 4) })
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
const frameOf = (file, n) => readPng(join(RAW, `${file}-${n}.png`))
/** Copies the columns of `src` in [from, to) onto `dst` at (x0, y0), shifted left by `shift`. */
function columns(dst, src, x0, y0, from, to, shift = 0) {
  for (let y = 0; y < src.h; y++) for (let x = from; x < to; x++) {
    const s = (y * src.w + x) * 4
    if (src.buf[s + 3] < 128) continue
    const o = ((y0 + y) * dst.w + x0 + x - shift) * 4
    src.buf.copy(dst.buf, o, s, s + 3); dst.buf[o + 3] = 255
  }
}
const leftmost = (src, to) => {
  for (let x = 0; x < to; x++) for (let y = 0; y < src.h; y++) if (src.buf[(y * src.w + x) * 4 + 3] >= 128) return x
  return 0
}

function build() {
  const names = Object.keys(POSES)
  const unique = (n) => [...new Set(POSES[n].play)]
  const rows = names.length + 1
  const room = readPng(join(RAW, 'room.png'))
  const sheet = rgba(Math.max(CELL * Math.max(...names.map((n) => unique(n).length), WALK.play.length + 1), room.w), CELL * rows + room.h)
  const map = { image: 'sprites/cast.png', width: sheet.w, height: sheet.h, poses: {}, props: {}, holes: {} }
  names.forEach((n, row) => {
    const cells = new Map()
    unique(n).forEach((frame, col) => {
      const src = frameOf(POSES[n].file, frame)
      const at = src.w === CELL ? { x: 0, y: 0 } : SEATED_AT
      if (src.w + at.x > CELL || src.h + at.y > CELL) throw new Error(`${n}-${frame}.png is ${src.w}x${src.h}, too big for the cell`)
      // Once he is clear of the chair, only his own columns: the scene draws the chair apart.
      if (POSES[n].play.indexOf(frame) >= (POSES[n].chairApart ?? Infinity)) columns(sheet, src, col * CELL + at.x, row * CELL + at.y, 0, CHAIR_FROM - 1)
      else copy(sheet, src, col * CELL + at.x, row * CELL + at.y)
      cells.set(frame, { x: col * CELL, y: row * CELL, w: CELL, h: CELL })
    })
    const { fps, once, chairApart } = POSES[n]
    map.poses[n] = { fps, frames: POSES[n].play.map((frame) => cells.get(frame)), ...(once ? { once } : {}), ...(chairApart === undefined ? {} : { chairApart }) }
  })
  const y = names.length * CELL, last = frameOf('standing', 8)
  columns(sheet, last, 0, y, CHAIR_FROM, CELL)
  map.props.chair = { x: 0, y, w: CELL, h: CELL }
  const walking = WALK.play.map((n) => frameOf(WALK.file, n))
  const start = leftmost(walking[0], CHAIR_FROM - 1)
  map.poses.walking = { fps: WALK.fps, frames: walking.map((src, i) => {
    columns(sheet, src, (i + 1) * CELL, y, 0, CHAIR_FROM - 1, leftmost(src, CHAIR_FROM - 1) - start)
    return { x: (i + 1) * CELL, y, w: CELL, h: CELL }
  }) }
  cutRoom(sheet, map, room, rows * CELL)
  return { sheet, map }
}

const pixel = (img, x, y) => img.buf.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)
const isGreen = (p) => p[0] === GREEN[0] && p[1] === GREEN[1] && p[2] === GREEN[2]
/** The room (a half of the frame below its title, its screen a hole), in a row below the cast; the map names the hole's box. */
function cutRoom(sheet, map, room, y0) {
  const mask = { x0: room.w, y0: room.h, x1: -1, y1: -1 }, cut = rgba(room.w, room.h)
  for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) {
    const p = pixel(room, x, y)
    if (isGreen(p)) { Object.assign(mask, { x0: Math.min(mask.x0, x), y0: Math.min(mask.y0, y), x1: Math.max(mask.x1, x), y1: Math.max(mask.y1, y) }); continue }
    const o = (y * room.w + x) * 4
    p.copy(cut.buf, o, 0, 3); cut.buf[o + 3] = 255
  }
  copy(sheet, cut, 0, y0)
  map.props.room = { x: 0, y: y0, w: room.w, h: room.h }
  map.holes = { screen: { x: mask.x0, y: mask.y0, w: mask.x1 - mask.x0 + 1, h: mask.y1 - mask.y0 + 1 } }
}

const { sheet, map } = build()
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'cast.png'), png(sheet))
writeFileSync(join(OUT, 'cast.json'), JSON.stringify(map) + '\n')
console.log(`cast.png ${sheet.w}x${sheet.h}, poses: ${Object.keys(map.poses).join(', ')}, props: ${Object.keys(map.props).join(', ')}`)

const args = process.argv.slice(2)
const pi = args.indexOf('--preview')
if (pi >= 0) {
  const scale = Number(args[args.indexOf('--scale') + 1]) || 4, bg = rgb('#1b1f2b')
  const p = rgba(sheet.w * scale, sheet.h * scale)
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const s = (Math.floor(y / scale) * sheet.w + Math.floor(x / scale)) * 4, o = (y * p.w + x) * 4
    if (sheet.buf[s + 3]) sheet.buf.copy(p.buf, o, s, s + 4)
    else { p.buf[o] = bg[0]; p.buf[o + 1] = bg[1]; p.buf[o + 2] = bg[2]; p.buf[o + 3] = 255 }
  }
  writeFileSync(args[pi + 1], png(p))
}
