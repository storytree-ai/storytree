import type { SetupLine } from "@storytree/agent-link";
import type { DraftResult } from "./feedback.js";

/** Only these actions cross from the help surface to the OS. No project data enters feedback. */
export interface SetupHelpBridge {
  readSetupLicense(): Promise<string>;
  checkSetupFolder(): Promise<readonly SetupLine[] | null>;
  openFeedbackDraft(draft: unknown): Promise<DraftResult>;
  copyHelpText(text: string): Promise<void>;
}
