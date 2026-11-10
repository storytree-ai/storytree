/**
 * Capability 6 · CI times. The page's read of the CI times (ADR-1030), declared once as its method and the channel it travels
 * on: the reading the map's bottom-left block shows. Data only: safe for the page and the preload.
 */
import type { CiTimesReading } from "./reading.js";

export interface CiTimesBridge {
  /** The project's CI times reading, undefined while none was recorded (capability 6). */
  ciTimes(project: string): Promise<CiTimesReading | undefined>;
}

export const CI_TIMES_CHANNELS = {
  ciTimes: "storytree:ci-times",
} as const;

/** The page's side, named in CI health's manifest (`pageChannels`): the desktop's preload offers the page these. */
export const ciTimesPageChannels = [CI_TIMES_CHANNELS];
