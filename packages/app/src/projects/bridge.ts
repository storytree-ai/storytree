/** Capability 2 · Storytree projects. The page's project-choosing operations and the channels they travel on (ADR-0649). Data only: safe for the page and preload. */
import type { ProjectSelection } from "./selection.js";

export interface ProjectsBridge {
  /** The names of the projects in the app's library, sorted. */
  listProjects(): Promise<string[]>;
  /** The current project list and the last chosen project, including newly set-up projects. */
  projectSelection(): Promise<ProjectSelection>;
  chooseProject(name: string): Promise<ProjectSelection>;
}

export const PROJECTS_CHANNELS = {
  listProjects: "storytree:list-projects",
  projectSelection: "storytree:project-selection",
  chooseProject: "storytree:choose-project",
} as const satisfies Record<keyof ProjectsBridge, string>;
