/** Capability 3 · First-run guide. The help surface's bridge to the main process. Data only: safe for the page and preload. */
import type { SetupLine } from "../setup/index.js";
import type { DraftResult } from "../journey-events/feedback.js";

/** The folder picked for Add project, and the project it now is (or already was). */
export interface AddedFolder {
  /** `brought back`: the folder of a project removed from this computer, which is that project here again. */
  status: "set up" | "already a project" | "brought back";
  project: string;
  folder: string;
}

/** This computer's factory folder: storytree's own, or one switched to, with who switched it and when (2.22). */
export interface FactoryFolder {
  folder: string;
  chosen: boolean;
  switched?: { through: "desktop app" | "command line" | "agent tool"; session?: string; at: string };
}

/** A folder made this computer's factory from the app: an empty one set up, or one already a factory. */
export interface ChosenFactory {
  status: "set up" | "already a factory";
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

/** An agent this computer runs, as the guide offers to connect it (ADR-1162 D3): connected already, or not yet. */
export interface AgentOnOffer {
  harness: string;
  agent: string;
  connected: boolean;
}

/** One agent connected from the guide: whether its tools are now registered, and what to do next. */
export interface AgentConnected {
  agent: string;
  connected: boolean;
  next: string;
}

/** A project's sentence as Settings → Projects shows it: what the project is, and who it is for. */
export interface ProjectSentence {
  what?: string;
  audience?: string;
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
  /** The agents this computer runs, each connected to this installation or not, read now; in a copy the installer did not deliver, why none is offered. */
  agentsToConnect(): Promise<AgentOnOffer[] | { notInstalled: string }>;
  /** Connect one of them, chosen in the guide; nothing is connected without that choice (ADR-0626 D5). */
  connectAgent(harness: unknown): Promise<AgentConnected>;
  checkSetupFolder(): Promise<readonly SetupLine[] | null>;
  /** This computer's factory folder, read now. */
  factoryFolder(): Promise<FactoryFolder>;
  /** Pick a folder and make it this computer's factory, with no approval (question_0b0b82eb8fbc); null when the picker was cancelled, a folder that cannot be one refused with why. */
  chooseFactory(): Promise<ChosenFactory | null>;
  /** Pick a folder and make it a project (ADR-0752 D2), or null when the picker was cancelled. */
  addProject(): Promise<AddedFolder | null>;
  /** Take a project off this computer's list and free its folder here (`kept`: its marker is in git, left for the user); its records stay in the library. */
  removeProject(name: unknown): Promise<{ status: "removed"; project: string; freed?: string; kept?: string }>;
  /** Project `name`'s sentence (ADR-1085 D1): what it is and who it is for, each half absent while unsaid. */
  projectSentence(name: unknown): Promise<ProjectSentence>;
  /** Write project `name`'s two halves, a blank half unsaid; the sentence as the library now holds it. */
  setProjectSentence(name: unknown, what: unknown, audience: unknown): Promise<ProjectSentence>;
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
  agentsToConnect: "storytree:agents-to-connect",
  connectAgent: "storytree:connect-agent",
  checkSetupFolder: "storytree:check-setup-folder",
  factoryFolder: "storytree:factory-folder",
  chooseFactory: "storytree:choose-factory",
  addProject: "storytree:add-project",
  removeProject: "storytree:remove-project",
  projectSentence: "storytree:project-sentence",
  setProjectSentence: "storytree:set-project-sentence",
  deletableProjects: "storytree:deletable-projects",
  deleteProject: "storytree:delete-project",
  openFeedbackDraft: "storytree:open-feedback-draft",
  copyHelpText: "storytree:copy-help-text",
} as const satisfies Record<Exclude<keyof SetupHelpBridge, "feedbackIdentity">, string>;
