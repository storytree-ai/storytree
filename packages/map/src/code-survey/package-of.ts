/**
 * Capability 8 · Code survey. The packages a story's code lives in, declared once: the map's code
 * survey, own health and the plan-edges check all read it (packages/dev-loop imports it as
 * @storytree/map/package-of), so a story whose package is named otherwise, or that owns several
 * (ADR-1066 D3), is added here and nowhere else. It imports nothing, so plain Node can load it as well as tsx.
 */

/** A story as the packages it owns are read from: its id and its title. */
export interface StoryNamed {
  readonly id: string;
  readonly title: string;
}

/**
 * Storytree's own stories whose package is not named after their title, by story id: an id is storytree's
 * alone, so a user's story titled "Setup" or "Context" keeps the title rule, and a rename never breaks the table.
 */
const PACKAGE_NAMED_OTHERWISE: Readonly<Record<string, string>> = {
  story_f9fb5136c28f: "cli", // The command line
  story_ca702fee28cb: "forest-world", // The world
  story_1d360b6227d8: "local-postgres", // The local database
  story_9abd84ab493f: "processes", // Process ledger
  story_1c73ed7506ca: "lag-in-use", // Lag in real use
  // ADR-1066 D4's developer-first names: the stories were renamed and their packages kept their names.
  story_6def59292b78: "project-and-caller", // Context
  story_e50347f0388e: "guardrails", // Architecture checks
  story_421e473f0a99: "quality-assurance", // Code review
  story_73dad81ba7a7: "map", // Code map
  story_deee4230348c: "forest", // Map view
  story_d754d997f22a: "knowledge-core", // Knowledge graph
  story_7722ddb5461e: "arc-surface", // Work board
  story_a93c6fb1a257: "app", // Desktop app
  story_b91056a06337: "app-setup", // Setup
  story_7d7b0ffccf55: "learning-as-you-build", // In-app guidance
};

/**
 * The packages a story owns beyond its own (ADR-1066 D3), by its own package's folder name under packages/,
 * each by its folder name: a story that folds another in names the folded story's package here.
 */
export const ALSO_OWNED: Readonly<Record<string, readonly string[]>> = { "dev-loop": ["agent-pool"], "project-and-caller": ["keys", "identity"], website: ["mark"] };

/** The package a story's code lives in: named after its title ("Session management" is packages/session-management), but for a few of storytree's own named otherwise. */
export function packageOf(story: StoryNamed): string {
  if (Object.hasOwn(PACKAGE_NAMED_OTHERWISE, story.id)) return PACKAGE_NAMED_OTHERWISE[story.id]!;
  return story.title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Every package a story owns, by folder name under packages/: its own ({@link packageOf}) first, then those `alsoOwned` gives it. */
export function packagesOf(story: StoryNamed, alsoOwned: Readonly<Record<string, readonly string[]>> = ALSO_OWNED): string[] {
  const own = packageOf(story);
  return [own, ...(Object.hasOwn(alsoOwned, own) ? alsoOwned[own]! : [])];
}
