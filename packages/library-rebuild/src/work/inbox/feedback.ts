// Capability 7 · Library API
import type { Pool } from "pg";

import type { FieldsOf, SchemaRecord, SchemaRecords, WriteOptions } from "../../storage/rules/index.js";

export interface FeedbackRoute {
  readonly route: NonNullable<FieldsOf<"feedback">["route"]>;
  readonly routedTo?: string;
  readonly routeReason: string;
}

export type FeedbackNote = Omit<FieldsOf<"feedback">, "status" | "screenshot" | "crop" | keyof FeedbackRoute>;

export interface FeedbackPictures {
  readonly screenshot?: Uint8Array | undefined;
  readonly crop?: Uint8Array | undefined;
}

export async function sendFeedback(records: SchemaRecords, pool: Pool, note: FeedbackNote, options: WriteOptions & FeedbackPictures = {}): Promise<SchemaRecord<"feedback">> {
  const { screenshot, crop, ...write } = options;
  if (crop !== undefined && screenshot === undefined) throw new Error("a crop to an element is kept only with its window picture");
  const sent = await records.create("feedback", { ...note, status: "new", screenshot: screenshot !== undefined, ...(crop === undefined ? {} : { crop: true }) }, write);
  if (screenshot !== undefined) {
    await pool.query("INSERT INTO feedback_screenshot (record_id, jpeg, element_jpeg) VALUES ($1, $2, $3)", [sent.id, Buffer.from(screenshot), crop === undefined ? null : Buffer.from(crop)]);
  }
  return sent;
}

export async function feedbackScreenshot(pool: Pool, id: string, { element = false }: { readonly element?: boolean } = {}): Promise<Uint8Array | null> {
  const { rows } = await pool.query<{ jpeg: Buffer; element_jpeg: Buffer | null }>("SELECT jpeg, element_jpeg FROM feedback_screenshot WHERE record_id = $1", [id]);
  const bytes = element ? rows[0]?.element_jpeg : rows[0]?.jpeg;
  return bytes === undefined || bytes === null ? null : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function routeFeedback(records: SchemaRecords, id: string, { route, routedTo, routeReason }: FeedbackRoute, options: WriteOptions = {}): Promise<SchemaRecord<"feedback"> | null> {
  const held = await records.get(id);
  if (held?.type !== "feedback") return null;
  const routed = await records.edit(id, { status: "routed", route, routeReason, ...(routedTo === undefined ? {} : { routedTo }) }, {
    ...options,
    checkCurrent: (current) => {
      if (current.type === "feedback" && current.fields.status === "routed") throw new Error(`${id} is already routed, so nothing was written`);
    },
  });
  return routed as SchemaRecord<"feedback"> | null;
}
