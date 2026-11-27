// Capability 13 · Decision log
import type { HistoryEntry } from "../../storage/store/index.js";

export interface DecisionNumberPlan {
  readonly id: string;
  readonly oldNumber: number | undefined;
  readonly number: number | undefined;
  readonly refusal?: string;
}

export const STORYTREE = "storytree";

const FULL_RECORD = /^Full record: ADR-(\d+)(?!\w)/;

export function mentionsFullRecord(text: string): boolean {
  return text.includes("Full record");
}

export function fullRecordNumber(text: string): number | undefined {
  const lines = text.split("\n").filter(mentionsFullRecord);
  if (lines.length !== 1) return undefined;
  const named = Number(FULL_RECORD.exec(lines[0]!)?.[1] ?? 0);
  return Number.isSafeInteger(named) && named > 0 ? named : undefined;
}

export function adr(number: number): string {
  return `ADR-${String(number).padStart(4, "0")}`;
}

export function heldNumbers(entries: readonly HistoryEntry[]): Set<number> {
  return new Set(entries.flatMap(({ type, record }) => {
    const number = record.fields["number"];
    return type !== "health" && typeof number === "number" ? [number] : [];
  }));
}

export function renumbered(entries: readonly HistoryEntry[], id: string): boolean {
  const numbers = entries.filter((entry) => entry.recordId === id && entry.action !== "retired").map(({ record }) => record.fields["number"]);
  return numbers.some((number) => number !== numbers[0]);
}

export function switchedOn(entries: readonly HistoryEntry[]): number {
  return entries.find((entry) => entry.type === "decisionNumbering" && entry.action === "created")?.seq ?? Number.POSITIVE_INFINITY;
}
