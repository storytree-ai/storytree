// Capability 7 · Instructions (the habits card)
import { habitsCard } from "./habits.js";

export interface HabitsCardMeasureReader {
  readonly measure: string;
  readonly version: number;
  sample(at: unknown): Promise<{ value: number; runs: number; spread: number }>;
}

const cardBytes = () => Buffer.byteLength(habitsCard(), "utf8");

export const HABITS_CARD_MEASURE_READERS: readonly HabitsCardMeasureReader[] = [
  { measure: "measure_b2c1a8adba99", version: 1, sample: async () => ({ value: cardBytes(), runs: 1, spread: 0 }) },
  { measure: "measure_34959955c3f6", version: 1, sample: async () => ({ value: Math.ceil(cardBytes() / 4), runs: 1, spread: 0 }) },
];
