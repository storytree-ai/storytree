// Capability 6 · CI times.
import type { CiTimesReading } from "./reading.js";

export interface CiTimesBridge {
  ciTimes(project: string): Promise<CiTimesReading | undefined>;
}

export const CI_TIMES_CHANNELS = {
  ciTimes: "storytree:ci-times",
} as const;

export const ciTimesPageChannels = [CI_TIMES_CHANNELS];
