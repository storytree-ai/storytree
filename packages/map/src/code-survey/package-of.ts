/**
 * Capability 8 · Code survey. The packages a story's code lives in, declared once: the map's code
 * survey, own health and the plan-edges check all read it (packages/dev-loop imports it as
 * @storytree/map/package-of), so a story whose package is named otherwise, or that owns several
 * (ADR-1066 D3), is added here and nowhere else. It imports nothing, so plain Node can load it as well as tsx.
 */

/** Stories whose package is not named after their title. */
const PACKAGE_NAMED_OTHERWISE: Readonly<Record<string, string>> = {
  "command-line": "cli", "world": "forest-world", "local-database": "local-postgres", "process-ledger": "processes", "lag-in-real-use": "lag-in-use",
  // ADR-1066 D4's developer-first names: the stories were renamed and their packages kept their names.
  "context": "project-and-caller", "architecture-checks": "guardrails", "code-review": "quality-assurance", "code-map": "map", "map-view": "forest",
  "knowledge-graph": "knowledge-core", "work-board": "arc-surface", "desktop-app": "app", "setup": "app-setup", "in-app-guidance": "learning-as-you-build",
};

/**
 * The packages a story owns beyond its own (ADR-1066 D3), by its own package's folder name under packages/,
 * each by its folder name: a story that folds another in names the folded story's package here.
 */
export const ALSO_OWNED: Readonly<Record<string, readonly string[]>> = { "dev-loop": ["agent-pool"], "library": ["local-postgres", "librarian"] };

/** The package a story's code lives in: named after its title ("Session management" is packages/session-management), but for a few named otherwise. */
export function packageOf(title: string): string {
  const name = title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return Object.hasOwn(PACKAGE_NAMED_OTHERWISE, name) ? PACKAGE_NAMED_OTHERWISE[name]! : name;
}

/** Every package a story owns, by folder name under packages/: its own ({@link packageOf}) first, then those `alsoOwned` gives it. */
export function packagesOf(title: string, alsoOwned: Readonly<Record<string, readonly string[]>> = ALSO_OWNED): string[] {
  const own = packageOf(title);
  return [own, ...(Object.hasOwn(alsoOwned, own) ? alsoOwned[own]! : [])];
}
