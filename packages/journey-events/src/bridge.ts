/** Data only: safe in the sandboxed renderer. Private deletion authorization never crosses IPC. */
export interface JourneyState {
  consent: "pending" | "on" | "off";
  available: boolean;
  installId: string;
  queued: number;
  retention?: string;
  deletionContact?: string;
}
export interface DeletionRequest { installId: string; contact?: string }
export interface JourneyBridge {
  readJourney(): Promise<JourneyState>;
  chooseJourney(on: boolean): Promise<JourneyState>;
  prepareJourneyDeletion(): Promise<DeletionRequest>;
}
export const JOURNEY_CHANNELS = {
  readJourney: "storytree:read-journey",
  chooseJourney: "storytree:choose-journey",
  prepareJourneyDeletion: "storytree:prepare-journey-deletion",
} as const;
