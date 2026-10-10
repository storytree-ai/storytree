/**
 * Capability 2 · Fixed-colour icon files: PNG, Windows .ico and macOS .icns written and read with node:zlib alone. Both icon
 * containers hold PNG entries, the form Windows (since Vista) and macOS (since 10.7) read.
 */
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The sizes of the committed PNGs, in pixels. */
export const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
/** The sizes a Windows .ico holds. */
export const ICO_SIZES = [16, 32, 48, 64, 128, 256];
/** The entries a macOS .icns holds, by type, with the size of each. */
export const ICNS_TYPES: Readonly<Record<string, number>> = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Straight RGBA pixels, row by row, as a PNG. */
export function writePng(pixels: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rows.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** A PNG this package wrote (8-bit RGBA, unfiltered rows) back to its pixels. */
export function readPng(file: Buffer): { width: number; height: number; pixels: Uint8Array } {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG.");
  let width = 0, height = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString("latin1", at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      if (body[8] !== 8 || body[9] !== 6) throw new Error("Not an 8-bit RGBA PNG.");
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(data));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    if (rows[start] !== 0) throw new Error("A PNG row is filtered.");
    pixels.set(rows.subarray(start + 1, start + 1 + width * 4), y * width * 4);
  }
  return { width, height, pixels };
}

/** A Windows .ico of PNG entries, smallest first. */
export function writeIco(entries: readonly { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header[at] = size >= 256 ? 0 : size;
    header[at + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

export function readIco(file: Buffer): { size: number; png: Buffer }[] {
  return Array.from({ length: file.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const length = file.readUInt32LE(at + 8), offset = file.readUInt32LE(at + 12);
    return { size: file[at] || 256, png: file.subarray(offset, offset + length) };
  });
}

/** A macOS .icns of PNG entries, in the order given. */
export function writeIcns(entries: readonly { type: string; png: Buffer }[]): Buffer {
  const parts = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "latin1");
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "latin1");
  head.writeUInt32BE(8 + parts.reduce((sum, p) => sum + p.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}

export function readIcns(file: Buffer): { type: string; png: Buffer }[] {
  if (file.toString("latin1", 0, 4) !== "icns") throw new Error("Not an .icns.");
  const out: { type: string; png: Buffer }[] = [];
  for (let at = 8; at < file.readUInt32BE(4);) {
    const length = file.readUInt32BE(at + 4);
    out.push({ type: file.toString("latin1", at, at + 4), png: file.subarray(at + 8, at + length) });
    at += length;
  }
  return out;
}
