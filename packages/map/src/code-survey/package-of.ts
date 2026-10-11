/**
 * Capability 8 · Code survey. The package a story's code lives in, declared once: the map's code
 * survey, own health and the plan-edges check all read it (packages/dev-loop imports it as
 * @storytree/map/package-of), so a story whose package is named otherwise is added here and nowhere
 * else. It imports nothing, so plain Node can load it as well as tsx.
 */

/** Stories whose package is not named after their title. */
const PACKAGE_NAMED_OTHERWISE: Readonly<Record<string, string>> = { "command-line": "cli", "world": "forest-world", "local-database": "local-postgres", "process-ledger": "processes", "lag-in-real-use": "lag-in-use" };

/** The package a story's code lives in: named after its title ("Session management" is packages/session-management), but for a few named otherwise. */
export function packageOf(title: string): string {
  const name = title.replace(/^the\s+/i, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return Object.hasOwn(PACKAGE_NAMED_OTHERWISE, name) ? PACKAGE_NAMED_OTHERWISE[name]! : name;
}
