/** The link layout, handed to the real map at build time (tools/build.mjs points every import of the map's
 * territories module here). Everything is the map's own module, re-exported unchanged, except `islandTerritories`:
 * for the selected story's island it returns the map's own cutter's finer cut (layout-core.ts's CUT) with each cell given to
 * the owner tools/layout.ts chose, or left open land, so the map's drawing, names, borders and lanes all read the new
 * arrangement. Rollout 1: an arrangement cut with every capability holding land (`codeless`, layout-core.ts's
 * withCodeless) is cut from the same shares here. `?layout=<name>` picks one of the arrangements in layouts/ (layouts.ts),
 * `?layout=today` the map's own. Other islands, and an island with no arrangement yet, are untouched. */
export * from "../../../../../packages/forest/src/territories/territories.ts";
import { islandTerritories as mapsOwn, territories, type Coast, type TerritoryMap, type TerritoryShare } from "../../../../../packages/forest/src/territories/territories.ts";
import snapshot from "../data.json" with { type: "json" };
import { layout } from "./layouts.ts";
import { STORY } from "./story.ts";
import { CUT, relayout, withCodeless } from "./layout-core.ts";

const TODAY = typeof location !== "undefined" && new URLSearchParams(location.search).get("layout") === "today";
const laid = new WeakMap<TerritoryMap, TerritoryMap>();
const capabilities = (snapshot.stories as Record<string, { capabilities: { id: string; title: string; description?: string; word: string; parked?: boolean }[] }>)[STORY]?.capabilities ?? [];
const own = new Set(capabilities.map(c => c.id));

export function islandTerritories(shares: readonly TerritoryShare[], coast: Coast): TerritoryMap {
  const map = mapsOwn(shares, coast);
  if (TODAY || !layout || !shares.some(share => share.capability !== undefined && own.has(share.capability))) return map;
  let out = laid.get(map);
  if (!out) { out = relayout(territories(layout.codeless ? withCodeless(shares, capabilities) : shares, coast, CUT), layout.owners); laid.set(map, out); }
  return out;
}
