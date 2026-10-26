/**
 * Capability 3 · Surfaces (the app story): the smoke check's judgement. The surface on show says
 * what it drew, and the check passes only if that is every story and capability of the project. A
 * surface drawn on a canvas, as the forest is, has no page text to search, so the check never reads
 * the page itself: it reads what the surface says.
 */
import type { AnnotatedTree } from "@storytree/library";

/**
 * What a surface says it drew, once it has drawn a project: which surface it is, and the ids of the
 * stories and capabilities it drew. It is written on the page as JSON, in the body's `data-drew`
 * attribute. A surface may add fields of its own; the smoke check reads only these.
 */
export interface Drawn {
  surface: string;
  stories: string[];
  capabilities: string[];
}

/**
 * What stops the smoke check passing, from the page's state (`data-state`), the project's tree, and
 * what the surface on show says it drew (`data-drew`'s text, undefined if it said nothing). No
 * problems means it passed.
 */
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

/** What `text` says was drawn, if it says it as a surface does; undefined otherwise. */
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
