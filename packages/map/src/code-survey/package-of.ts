// Capability 8 · Code survey

export interface StoryNamed {
  readonly id: string;
  readonly title: string;
  readonly plugin?: string;
}

const PACKAGE_NAMED_OTHERWISE: Readonly<Record<string, string>> = {
  story_f9fb5136c28f: "cli",
  story_5e19e65c3433: "local-postgres",
  story_ed2c6b55715d: "forest-world",
  story_6def59292b78: "project-and-caller",
  story_73dad81ba7a7: "map",
  story_deee4230348c: "forest",
  story_d754d997f22a: "knowledge-core",
  story_7722ddb5461e: "arc-surface",
  story_a93c6fb1a257: "app",
  story_b91056a06337: "app-setup",
  story_b2051c0f7372: "agent-pool",
  story_08790ee19bbf: "mark",
  story_c27bd2a8f61e: "repo-checks",
};

export const ALSO_OWNED: Readonly<Record<string, readonly string[]>> = {};

export function packageOf(story: StoryNamed): string {
  if (Object.hasOwn(PACKAGE_NAMED_OTHERWISE, story.id)) return PACKAGE_NAMED_OTHERWISE[story.id]!;
  if (story.plugin !== undefined) return story.plugin;
  return story.title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function packagesOf(story: StoryNamed, alsoOwned: Readonly<Record<string, readonly string[]>> = ALSO_OWNED): string[] {
  const own = packageOf(story);
  return [own, ...(Object.hasOwn(alsoOwned, own) ? alsoOwned[own]! : [])];
}
