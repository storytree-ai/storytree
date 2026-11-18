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
