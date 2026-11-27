// Capability 7 · Library API
import { createHash } from "node:crypto";

import type { Pool } from "pg";

import type { WriteOptions } from "../storage/rules/index.js";

export const MEDIA_LIMIT = 10 * 1024 * 1024;

export interface NewMedia {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export interface MediaEntry {
  readonly recordId: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly sha256: string;
  readonly addedAt: string;
  readonly addedBy?: string;
}

export interface MediaFile extends MediaEntry {
  readonly bytes: Uint8Array;
}

export interface AttachedMedia extends MediaEntry {
  readonly outcome: "added" | "same" | "replaced";
}

interface MediaRow {
  record_id: string;
  name: string;
  type: string;
  size: string;
  sha256: string;
  added_at: Date;
  added_by: string | null;
  bytes?: Buffer;
}

const ENTRY = "record_id, name, type, size, sha256, added_at, added_by";

function entryOf(row: MediaRow): MediaEntry {
  return {
    recordId: row.record_id,
    name: row.name,
    type: row.type,
    size: Number(row.size),
    sha256: row.sha256,
    addedAt: row.added_at.toISOString(),
    ...(row.added_by === null ? {} : { addedBy: row.added_by }),
  };
}

export function bytesOf(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function attachMedia(pool: Pool, live: (id: string) => Promise<boolean>, id: string, file: NewMedia, options: WriteOptions & { readonly replace?: boolean } = {}): Promise<AttachedMedia> {
  if (!/^[^/\\\u0000-\u001f]+$/.test(file.name) || file.name.startsWith(".")) throw new RangeError(`${JSON.stringify(file.name)} is not a file name media can be kept under`);
  if (!/^[a-z]+\/[a-z0-9][a-z0-9.+-]*$/i.test(file.type)) throw new RangeError(`${JSON.stringify(file.type)} is not a media type`);
  if (file.bytes.length > MEDIA_LIMIT) throw new RangeError(`${file.name} is ${file.bytes.length} bytes, past the 10 MB a record's media may be`);
  if (!(await live(id))) throw new Error(`there is no live record ${id} to keep ${file.name} beside`);
  const sha256 = sha256Of(file.bytes);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const held = (await client.query<MediaRow>(`SELECT ${ENTRY} FROM media WHERE record_id = $1 AND name = $2 FOR UPDATE`, [id, file.name])).rows[0];
      if (held !== undefined && held.sha256 === sha256) {
        await client.query("COMMIT");
        return { ...entryOf(held), outcome: "same" };
      }
      if (held !== undefined && options.replace !== true) throw new Error(`${file.name} on ${id} already holds other bytes; pass replace to put these in their place`);
      const { rows } = await client.query<MediaRow>(
        `INSERT INTO media (record_id, name, type, size, sha256, added_by, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (record_id, name) DO UPDATE SET type = EXCLUDED.type, size = EXCLUDED.size, sha256 = EXCLUDED.sha256, added_at = clock_timestamp(), added_by = EXCLUDED.added_by, bytes = EXCLUDED.bytes
         RETURNING ${ENTRY}`,
        [id, file.name, file.type, file.bytes.length, sha256, options.actor ?? null, Buffer.from(file.bytes)],
      );
      await client.query("COMMIT");
      return { ...entryOf(rows[0]!), outcome: held === undefined ? "added" : "replaced" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function media(pool: Pool, id: string): Promise<MediaEntry[]> {
  const { rows } = await pool.query<MediaRow>(`SELECT ${ENTRY} FROM media WHERE record_id = $1 ORDER BY name COLLATE "C"`, [id]);
  return rows.map(entryOf);
}

export async function mediaFile(pool: Pool, id: string, name: string): Promise<MediaFile | null> {
  const row = (await pool.query<MediaRow>(`SELECT ${ENTRY}, bytes FROM media WHERE record_id = $1 AND name = $2`, [id, name])).rows[0];
  return row === undefined ? null : { ...entryOf(row), bytes: bytesOf(row.bytes!) };
}
