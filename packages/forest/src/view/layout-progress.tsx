/**
 * Capability 3 · Story node render (the forest story): what the map says of the islands still being laid out, and which
 * island it lays out first (question_bb933ce50f45, option D).
 *
 * - 3.96: a small mark in the map's top left while any island's territory search runs or waits its turn, or its roads
 *   route or wait theirs ("laying out 3 of 12 islands"); it goes when both are idle. 3.95's "laying out parts…" under a
 *   waiting island's name stays.
 * - 3.97: the island on screen, the one selected, else the island that joined the map last, is searched next.
 */
import React, { useMemo, useSyncExternalStore } from "react";

import { islandsSearching, searchingVersion, subscribeSearching } from "../territories/kept-layout.js";
import { islandsRouting, routingVersion, subscribeRouting } from "../territories/island-roads.js";

/** The map's top-left mark: how many of `islands` are still searched or routed, or nothing when none are. */
export function LayoutProgress({ islands }: { islands: readonly string[] }) {
  const searching = useSyncExternalStore(subscribeSearching, searchingVersion, searchingVersion);
  const routing = useSyncExternalStore(subscribeRouting, routingVersion, routingVersion);
  const busy = useMemo(() => {
    const searched = islandsSearching(), routed = islandsRouting();
    return islands.filter((story) => searched.has(story) || routed.has(story)).length;
  }, [islands, searching, routing]);
  if (busy === 0) return null;
  return <div className="forest-layout-progress" role="status">{`laying out ${busy} of ${islands.length} island${islands.length === 1 ? "" : "s"}`}</div>;
}

/**
 * Which island is on screen, map by map (3.97): `selected`, else the island that joined the map last and is still on it.
 * The islands the map first opens with joined none later, so they name none.
 */
export function onScreenIsland(): (islands: readonly string[], selected: string | undefined) => string | undefined {
  let seen: Set<string> | undefined;
  const joined: string[] = [];
  return (islands, selected) => {
    if (seen === undefined) { if (islands.length > 0) seen = new Set(islands); }
    else for (const story of islands) if (!seen.has(story)) { seen.add(story); joined.push(story); }
    const here = new Set(islands);
    return selected ?? joined.findLast((story) => here.has(story));
  };
}
