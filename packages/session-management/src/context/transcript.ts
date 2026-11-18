// Capability 9 · Context readings

export type JsonRecord = Record<string, unknown>;

export const SYNTHETIC = "<synthetic>";

export function jsonLines(text: string): JsonRecord[] | "empty" {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return "empty";
  const records: JsonRecord[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
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
