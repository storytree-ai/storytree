/** Capability 3 · First-run guide. The help surface's bridge to the main process. Data only: safe for the page and preload. */
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

/** Already verified by the identity story; neither tokens nor provider subjects enter this bridge. */
export interface FeedbackAccount { readonly id: string; readonly email: string }
export interface FeedbackIdentityBridge {
  status(): Promise<FeedbackAccount | null>;
  signIn(): Promise<FeedbackAccount>;
  signOut(): Promise<void>;
}

/** Feedback sign-in's channels; whether this build offers it is asked once, synchronously, before the page loads (app setup 5.6). */
export const FEEDBACK_IDENTITY_OFFERED = "storytree:feedback-identity-offered";
export const FEEDBACK_IDENTITY_CHANNELS = {
  status: "storytree:feedback-identity-status",
  signIn: "storytree:feedback-identity-sign-in",
  signOut: "storytree:feedback-identity-sign-out",
} as const satisfies Record<keyof FeedbackIdentityBridge, string>;

/** Only these actions cross from the help surface to the OS. No project data enters feedback. */
export interface SetupHelpBridge {
  /** Present only after the desktop identity integration is configured. Never needed for basic use. */
  readonly feedbackIdentity?: FeedbackIdentityBridge;
  readSetupLicense(): Promise<string>;
  /** Each connected agent that still needs a step from the user, or has taken it; read now. */
  agentConnections(): Promise<AgentConnection[]>;
  checkSetupFolder(): Promise<readonly SetupLine[] | null>;
  /** Pick a folder and make it a project (ADR-0752 D2), or null when the picker was cancelled. */
  addProject(): Promise<AddedFolder | null>;
  /** Take a project off this computer's list and free its folder here (`kept`: its marker is in git, left for the user); its records stay in the library. */
  removeProject(name: unknown): Promise<{ status: "removed"; project: string; freed?: string; kept?: string }>;
  /** The projects that may be deleted from here (all in the library but the one on show), each with where its records live and who loses them. */
  deletableProjects(): Promise<{ project: string; warning: string }[]>;
  /** Delete a project's records for every computer using the library (ADR-0831), once `typed` is its name, after a snapshot into this computer's backups when asked; a refusal is thrown with its reason. */
  deleteProject(name: unknown, typed: unknown, snapshot: unknown): Promise<{ status: "deleted"; project: string; snapshot?: string; freed?: string; kept?: string }>;
  openFeedbackDraft(draft: unknown): Promise<DraftResult>;
  copyHelpText(text: string): Promise<void>;
}

/** The channels the help surface's actions travel on (ADR-0649); feedback sign-in has its own, above. */
export const SETUP_HELP_CHANNELS = {
  readSetupLicense: "storytree:read-setup-license",
  agentConnections: "storytree:agent-connections",
  checkSetupFolder: "storytree:check-setup-folder",
  addProject: "storytree:add-project",
  removeProject: "storytree:remove-project",
  deletableProjects: "storytree:deletable-projects",
  deleteProject: "storytree:delete-project",
  openFeedbackDraft: "storytree:open-feedback-draft",
  copyHelpText: "storytree:copy-help-text",
} as const satisfies Record<Exclude<keyof SetupHelpBridge, "feedbackIdentity">, string>;
