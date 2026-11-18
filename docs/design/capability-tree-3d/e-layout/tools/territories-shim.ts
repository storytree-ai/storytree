export * from "../../../../../packages/forest/src/territories/territories.ts";
import { islandTerritories as mapsOwn, type Coast, type TerritoryMap, type TerritoryShare } from "../../../../../packages/forest/src/territories/territories.ts";
import layout from "../layout.json" with { type: "json" };
import { relayout } from "./layout-core.ts";

const TODAY = typeof location !== "undefined" && new URLSearchParams(location.search).get("layout") === "today";
const laid = new WeakMap<TerritoryMap, TerritoryMap>();
const marker = layout.owners[0];

export function islandTerritories(shares: readonly TerritoryShare[], coast: Coast): TerritoryMap {
  const map = mapsOwn(shares, coast);
  if (TODAY || !shares.some(share => share.capability === marker)) return map;
  let out = laid.get(map);
  if (!out) { out = relayout(map, layout.owners); laid.set(map, out); }
  return out;
}
