import type { SetupLine } from "@storytree/agent-link";
import type { DraftResult } from "./feedback.js";

/** The folder picked for Add project, and the project it now is (or already was). */
export interface AddedFolder {
  status: "set up" | "already a project";
  project: string;
  folder: string;
}

/** Only these actions cross from the help surface to the OS. No project data enters feedback. */
export interface SetupHelpBridge {
  readSetupLicense(): Promise<string>;
  checkSetupFolder(): Promise<readonly SetupLine[] | null>;
  /** Pick a folder and make it a project (ADR-0752 D2), or null when the picker was cancelled. */
  addProject(): Promise<AddedFolder | null>;
  openFeedbackDraft(draft: unknown): Promise<DraftResult>;
  copyHelpText(text: string): Promise<void>;
}
