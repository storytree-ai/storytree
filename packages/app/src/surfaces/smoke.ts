// Capability 3 · Surfaces
import type { AnnotatedTree } from "@storytree/library";

export interface Drawn {
  surface: string;
  stories: string[];
  capabilities: string[];
}

export function smokeProblems(state: string, tree: AnnotatedTree | undefined, drew: string | undefined): string[] {
  if (state !== "ready") return [`the page did not show a project (its state is "${state}")`];
  if (tree === undefined) return ["no project was opened"];
  if (tree.stories.length === 0) return ["the project has no stories to draw"];
  const drawn = parseDrawn(drew);
  if (drawn === undefined) return ["the surface on show did not say what it drew"];
  const stories = new Set(drawn.stories);
  const capabilities = new Set(drawn.capabilities);
  const problems: string[] = [];
  for (const story of tree.stories) {
    if (!stories.has(story.id)) problems.push(`the ${drawn.surface} did not draw story "${story.title}"`);
    for (const capability of story.capabilities) {
      if (!capabilities.has(capability.id)) problems.push(`the ${drawn.surface} did not draw capability "${capability.title}"`);
    }
  }
  return problems;
}

function parseDrawn(text: string | undefined): Drawn | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
  const { surface, stories, capabilities } = (value ?? {}) as Partial<Record<keyof Drawn, unknown>>;
  if (typeof surface !== "string" || !isStrings(stories) || !isStrings(capabilities)) return undefined;
  return { surface, stories, capabilities };
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
