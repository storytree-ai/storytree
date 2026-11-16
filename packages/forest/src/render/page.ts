/**
 * Capability 7 · Running sessions. The forest's own read of the app (ADR-0649), declared once as its method and the channel it
 * travels on: each story's code survey, which the host reads from the project's checkout, and the agents' pins, each read live or stale against the code (3.119). Data only: safe for the page and preload.
 */
import type { SchemaRecord, StorySurvey } from "@storytree/library";

/** A pin as the forest reads it: its record, and why it is stale once its anchor no longer resolves (map 9.2). */
export type ForestPin = { readonly pin: SchemaRecord<"pin">; readonly stale?: string };

export interface ForestBridge {
  /** Each story's code survey, by story id, read now from the project's checkout on this machine (map 8); none when there is no checkout here. */
  codeSurvey(project: string): Promise<Readonly<Record<string, StorySurvey>>>;
  /** The project's live pins, each stale with why once its anchor no longer resolves in the code last surveyed here (map 9.2); none read stale before a survey. */
  pins(project: string): Promise<readonly ForestPin[]>;
}

export const FOREST_CHANNELS = {
  codeSurvey: "storytree:code-survey",
  pins: "storytree:pins",
} as const;

/** The page's side, named in the forest's manifest (`pageChannels`, ADR-1030): the desktop's preload offers the page these. */
export const forestPageChannels = [FOREST_CHANNELS];
