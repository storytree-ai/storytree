/** Reading a harness transcript line by line: shared by the token reading (9.1-9.3) and the composition (9.8). */

export type JsonRecord = Record<string, unknown>;

/** The harness's marker for a line it made itself rather than the model answering. */
export const SYNTHETIC = "<synthetic>";

/** Each line of `text` that is a JSON object; "empty" for a text with no lines at all. */
export function jsonLines(text: string): JsonRecord[] | "empty" {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return "empty";
  const records: JsonRecord[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // A line cut short while the harness writes it, or one that is not JSON: not a reading.
    }
  }
  return records;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
