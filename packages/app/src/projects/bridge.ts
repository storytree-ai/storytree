// Capability 2 · Storytree projects
import type { ProjectSelection } from "./selection.js";

export interface ProjectsBridge {
  listProjects(): Promise<string[]>;
  projectSelection(): Promise<ProjectSelection>;
  chooseProject(name: string): Promise<ProjectSelection>;
}

export const PROJECTS_CHANNELS = {
  listProjects: "storytree:list-projects",
  projectSelection: "storytree:project-selection",
  chooseProject: "storytree:choose-project",
} as const satisfies Record<keyof ProjectsBridge, string>;
