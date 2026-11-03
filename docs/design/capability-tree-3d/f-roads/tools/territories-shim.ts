/** Round 9: the link layout with open land round the island, handed to the real map at build time (tools/build.mjs points every import of the map's
 * territories module here). Everything is the map's own module, re-exported unchanged, except `islandTerritories`:
 * for The library's island it returns the map's own cut with each cell given to the owner tools/layout.ts chose
 * (layout-core.ts), so the map's drawing, names, borders and lanes all read the new arrangement. `?layout=today`
 * leaves the map's own arrangement. Other islands are untouched. */
export * from "../../../../../packages/forest/src/territories/territories.ts";
import { islandTerritories as mapsOwn, type Coast, type TerritoryMap, type TerritoryShare } from "../../../../../packages/forest/src/territories/territories.ts";
import layout from "../layout.json" with { type: "json" };
import { relayout, sharesWithOpen } from "./layout-core.ts";

const TODAY = typeof location !== "undefined" && new URLSearchParams(location.search).get("layout") === "today";
const laid = new WeakMap<TerritoryMap, TerritoryMap>();
const marker = layout.owners.find(owner => owner !== null);

export function islandTerritories(shares: readonly TerritoryShare[], coast: Coast): TerritoryMap {
  if (TODAY || !shares.some(share => share.capability === marker)) return mapsOwn(shares, coast);
  // The library's island: its shares and the open land, cut by the map, then laid out by the links.
  const map = mapsOwn(sharesWithOpen(shares), coast);
  let out = laid.get(map);
  if (!out) { out = relayout(map, layout.owners as (string | null)[]); laid.set(map, out); }
  return out;
}
