// Capability 17 · The library's commands
import { z } from "zod";

import { RECORD_SCHEMAS } from "../../storage/rules/index.js";
import { fieldValue } from "../kit/index.js";

const ONE_LINE: readonly string[] = ["title", "term"];

function shapeOf(kind: string): Readonly<Record<string, z.ZodType>> {
  const schema = (RECORD_SCHEMAS as Readonly<Record<string, z.ZodType>>)[kind];
  return schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodType>) : {};
}

function valueFor(field: z.ZodType | undefined, text: string): unknown {
  if (field === undefined || field.safeParse(text).success) return text;
  const list = text.split(",").map((one) => one.trim()).filter((one) => one !== "");
  for (const candidate of [fieldValue(text), list]) if (field.safeParse(candidate).success) return candidate;
  return fieldValue(text);
}

export function givenFields(kind: string, given: Readonly<Record<string, string>>): Record<string, unknown> {
  const shape = shapeOf(kind);
  return Object.fromEntries(Object.entries(given).map(([field, text]) => [field, valueFor(shape[field], ONE_LINE.includes(field) ? text.replace(/\r?\n$/, "") : text)]));
}
