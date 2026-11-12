/**
 * Capability 3 · Story node render (the forest story): what the map says of the islands still being laid out, and which
 * island it lays out first (question_bb933ce50f45, option D).
 *
 * - 3.96: a small mark in the map's top left while any island's territory search runs or waits its turn, or its roads
 *   route or wait theirs ("laying out 3 of 12 islands"); it goes when both are idle. 3.95's "laying out capabilities…" under a
 *   waiting island's name stays.
 * - 3.98: the islands still awaiting their first territory search count in that mark too, and once none awaits, is searched or
 *   is routed, a hidden mark says the map has settled (`data-layout="settled"`), the one signal a capture waits on.
 * - 3.101: an island on the map whose land is not yet laid out and drawn for its docks and roads as they are now, kept or
 *   not, holds the map unsettled too: a chain's docks come after its kept islands drew, and each is laid out again for them.
 * - 3.97: the island on screen, the one selected, else the island that joined the map last, is searched next.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { awaitingLayout, islandsSearching, keptVersion, pageTerritorySearcher, searchingVersion, subscribeKept, subscribeSearching, type TerritorySearcher } from "../territories/kept-layout.js";
import type { TerritoryShare } from "../territories/territories.js";
import { islandsRouting, routingVersion, subscribeRouting } from "../territories/island-roads.js";

/** How many holds each story's island has on the map's mark, as not yet laid out (3.101). */
const heldFor = new Map<string, number>();
const holdListeners = new Set<() => void>();
let heldAt = 0;
function subscribeHeld(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => { holdListeners.delete(listener); };
}
const heldVersion = (): number => heldAt;
function held(story: string, by: 1 | -1): void {
  const was = heldFor.get(story) ?? 0, now = was + by;
  if (now > 0) heldFor.set(story, now); else heldFor.delete(story);
  if ((was > 0) === (now > 0)) return;
  heldAt++;
  for (const listener of holdListeners) listener();
}

/** Counts `story`'s island as laying out in the map's mark until the call it returns lets go, which it does once (3.101). */
export function holdLayingOut(story: string): () => void {
  let holding = true;
  held(story, 1);
  return () => { if (!holding) return; holding = false; held(story, -1); };
}

/**
 * Holds `story`'s island as laying out while it is mounted and not `laidOut` (3.101). The hold is taken in the commit that
 * mounts it, before a frame can draw it, and let go after the effects of the commit that lays it out, so what they start
 * (its roads, the island drawn under it) counts first and the mark shows no gap.
 */
export function useLayingOut(story: string, laidOut: boolean): void {
  // `story` is the island's own, the same for as long as it is mounted.
  const letGo = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => { if (!laidOut) letGo.current ??= holdLayingOut(story); }, [story, laidOut]);
  useEffect(() => { if (laidOut) { letGo.current?.(); letGo.current = undefined; } }, [laidOut]);
  useLayoutEffect(() => () => { letGo.current?.(); letGo.current = undefined; }, []);
}

/** An island on the map, with its land's territories once it has land. */
export interface LaidIsland { readonly story: string; readonly territories?: readonly TerritoryShare[] | undefined }

/**
 * The map's top-left mark: how many of `islands` still await their layout, are searched, are routed or are held as
 * not yet laid out; once none
 * is, a hidden mark that the map has settled, and nothing while the map has no islands. `searcher` is the page's own
 * territory search unless one is given.
 */
export function LayoutProgress({ islands, searcher: given }: { islands: readonly LaidIsland[]; searcher?: TerritorySearcher | undefined }) {
  const searcher = useMemo(() => given ?? pageTerritorySearcher(), [given]);
  const searching = useSyncExternalStore(subscribeSearching, searchingVersion, searchingVersion);
  const routing = useSyncExternalStore(subscribeRouting, routingVersion, routingVersion);
  const kept = useSyncExternalStore(subscribeKept, keptVersion, keptVersion);
  const holding = useSyncExternalStore(subscribeHeld, heldVersion, heldVersion);
  const busy = useMemo(() => {
    const searched = islandsSearching(), routed = islandsRouting();
    return islands.filter(({ story, territories }) => searched.has(story) || routed.has(story) || heldFor.has(story)
      || (territories !== undefined && awaitingLayout(story, territories, searcher))).length;
  }, [islands, searcher, searching, routing, kept, holding]);
  if (islands.length === 0) return null;
  if (busy === 0) return <div hidden data-layout="settled" />;
  return <div className="forest-layout-progress" role="status" data-layout="laying-out">{`laying out ${busy} of ${islands.length} island${islands.length === 1 ? "" : "s"}`}</div>;
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
