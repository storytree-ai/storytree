/** Capability 3 · Story node render: recorded landings, separate from either health column. */
import type { Island } from "@storytree/forest-world/scene";

/** The nameplate's neutral progress meter; surveyed islands already have their code presentation. */
export function islandProgress(island: Island): { landed: number; total: number } | undefined {
  if (island.land !== undefined && island.land.files.length > 0) return undefined;
  const capabilities = island.trees.filter(tree => tree.capability !== undefined);
  if (capabilities.length === 0) return undefined;
  // All landed forms count equally: their reported-health colour is not a verified verdict.
  return { landed: capabilities.filter(tree => tree.form !== "seedling").length, total: capabilities.length };
}
