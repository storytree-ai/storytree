// Capability 7 · Running sessions
import type { SchemaRecord, StorySurvey } from "@storytree/library";

export type ForestPin = { readonly pin: SchemaRecord<"pin">; readonly stale?: string };

export interface ForestBridge {
  codeSurvey(project: string): Promise<Readonly<Record<string, StorySurvey>>>;
  pins(project: string): Promise<readonly ForestPin[]>;
}

export const FOREST_CHANNELS = {
  codeSurvey: "storytree:code-survey",
  pins: "storytree:pins",
} as const;

export const forestPageChannels = [FOREST_CHANNELS];
