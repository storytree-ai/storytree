import type { SetupLine } from "@storytree/agent-link";
import type { DraftResult } from "./feedback.js";

/** The folder picked for Add project, and the project it now is (or already was). */
export interface AddedFolder {
  status: "set up" | "already a project";
  project: string;
  folder: string;
}

/**
 * An agent's connection as the first-run guide shows it: today only Codex, whose hooks run only once
 * the user has trusted them there; `step` is the one thing to do while they wait.
 */
export interface AgentConnection {
  agent: "Codex";
  state: "running" | "waiting";
  message: string;
  step?: string;
}

/** Only these actions cross from the help surface to the OS. No project data enters feedback. */
export interface SetupHelpBridge {
  readSetupLicense(): Promise<string>;
  /** Each connected agent that still needs a step from the user, or has taken it; read now. */
  agentConnections(): Promise<AgentConnection[]>;
  checkSetupFolder(): Promise<readonly SetupLine[] | null>;
  /** Pick a folder and make it a project (ADR-0752 D2), or null when the picker was cancelled. */
  addProject(): Promise<AddedFolder | null>;
  openFeedbackDraft(draft: unknown): Promise<DraftResult>;
  copyHelpText(text: string): Promise<void>;
}
