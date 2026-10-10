/**
 * Capability 7 · Running sessions. The forest's own read of the app (ADR-0649), declared once as its method and the channel it
 * travels on: each story's code survey, which the host reads from the project's checkout. Data only: safe for the page and preload.
 */
import type { StorySurvey } from "@storytree/map";

export interface ForestBridge {
  /** Each story's code survey, by story id, read now from the project's checkout on this machine (map 8); none when there is no checkout here. */
  codeSurvey(project: string): Promise<Readonly<Record<string, StorySurvey>>>;
}

export const FOREST_CHANNELS = {
  codeSurvey: "storytree:code-survey",
} as const;
