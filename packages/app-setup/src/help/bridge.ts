// Capability 3 · First-run guide.
import type { SetupLine } from "../setup/index.js";
import type { DraftResult } from "../journey-events/feedback.js";

export interface AddedFolder {
  status: "set up" | "already a project" | "brought back";
  project: string;
  folder: string;
  replaced?: string;
  unreadable?: string[];
}

export interface FactoryFolder {
  folder: string;
  chosen: boolean;
  switched?: { through: "desktop app" | "command line" | "agent tool"; session?: string; at: string };
}

export interface ChosenFactory {
  status: "set up" | "already a factory";
  folder: string;
}

export interface AgentConnection {
  agent: "Codex";
  state: "running" | "waiting";
  message: string;
  step?: string;
}

export interface AgentOnOffer {
  harness: string;
  agent: string;
  connected: boolean;
  note?: string;
}

export const AGENT_SEARCH_SECONDS = 15;

export interface AgentConnected {
  agent: string;
  connected: boolean;
  next: string;
  where?: string;
}

export interface ProjectSentence {
  what?: string;
  audience?: string;
}

export interface FeedbackAccount { readonly id: string; readonly email: string }
export interface FeedbackIdentityBridge {
  status(): Promise<FeedbackAccount | null>;
  signIn(): Promise<FeedbackAccount>;
  signOut(): Promise<void>;
}

export const FEEDBACK_IDENTITY_OFFERED = "storytree:feedback-identity-offered";
export const FEEDBACK_IDENTITY_CHANNELS = {
  status: "storytree:feedback-identity-status",
  signIn: "storytree:feedback-identity-sign-in",
  signOut: "storytree:feedback-identity-sign-out",
} as const satisfies Record<keyof FeedbackIdentityBridge, string>;

export interface SetupHelpBridge {
  readonly feedbackIdentity?: FeedbackIdentityBridge;
  readSetupLicense(): Promise<string>;
  agentConnections(): Promise<AgentConnection[]>;
  agentsToConnect(): Promise<AgentOnOffer[] | { notInstalled: string }>;
  connectAgent(harness: unknown): Promise<AgentConnected>;
  checkSetupFolder(): Promise<readonly SetupLine[] | null>;
  factoryFolder(): Promise<FactoryFolder>;
  chooseFactory(): Promise<ChosenFactory | null>;
  addProject(): Promise<AddedFolder | null>;
  removeProject(name: unknown): Promise<{ status: "removed"; project: string; freed?: string; kept?: string }>;
  projectSentence(name: unknown): Promise<ProjectSentence>;
  setProjectSentence(name: unknown, what: unknown, audience: unknown): Promise<ProjectSentence>;
  deletableProjects(): Promise<{ project: string; warning: string }[]>;
  deleteProject(name: unknown, typed: unknown, snapshot: unknown): Promise<{ status: "deleted"; project: string; snapshot?: string; freed?: string; kept?: string }>;
  openFeedbackDraft(draft: unknown): Promise<DraftResult>;
  copyHelpText(text: string): Promise<void>;
}

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
