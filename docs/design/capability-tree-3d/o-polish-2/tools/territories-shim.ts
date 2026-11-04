/** The link layout, handed to the real map at build time (tools/build.mjs points every import of the map's
 * territories module here). Everything is the map's own module, re-exported unchanged, except `islandTerritories`:
 * for The library's island it returns the map's own cutter's finer cut (layout-core.ts's CUT) with each cell given to the
 * owner tools/layout.ts chose, or left open land, so the map's drawing, names, borders and lanes all read the new
 * arrangement. Round 13: `?layout=<name>` picks one of the arrangements in layouts/ (layouts.ts), `?layout=today` the
 * map's own. Other islands are untouched. */
export * from "../../../../../packages/forest/src/territories/territories.ts";
import { islandTerritories as mapsOwn, territories, type Coast, type TerritoryMap, type TerritoryShare } from "../../../../../packages/forest/src/territories/territories.ts";
import { layout } from "./layouts.ts";
import { CUT, relayout } from "./layout-core.ts";

const TODAY = typeof location !== "undefined" && new URLSearchParams(location.search).get("layout") === "today";
const laid = new WeakMap<TerritoryMap, TerritoryMap>();
const marker = layout.owners.find(owner => owner !== "")!;

export function islandTerritories(shares: readonly TerritoryShare[], coast: Coast): TerritoryMap {
  const map = mapsOwn(shares, coast);
  if (TODAY || !shares.some(share => share.capability === marker)) return map;
  let out = laid.get(map);
  if (!out) { out = relayout(territories(shares, coast, CUT), layout.owners); laid.set(map, out); }
  return out;
}
