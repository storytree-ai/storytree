// Capability 3 · Story node render
import { CONCEPTS } from "@storytree/shown-words";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { awaitingLayout, islandsSearching, keptVersion, pageTerritorySearcher, searchingVersion, subscribeKept, subscribeSearching, type TerritorySearcher } from "../territories/kept-layout.js";
import type { TerritoryShare } from "../territories/territories.js";
import { islandsRouting, routingVersion, subscribeRouting } from "../territories/island-roads.js";

export const LAYING_OUT = `laying out ${CONCEPTS.capability.many}…`;

export function LayingOutLabel({ awaiting }: { awaiting: boolean }) {
  return awaiting ? <span className="planet-nameplate-laying-out">{LAYING_OUT}</span> : null;
}

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

export function holdLayingOut(story: string): () => void {
  let holding = true;
  held(story, 1);
  return () => { if (!holding) return; holding = false; held(story, -1); };
}

export function useLayingOut(story: string, laidOut: boolean): void {
  const letGo = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => { if (!laidOut) letGo.current ??= holdLayingOut(story); }, [story, laidOut]);
  useEffect(() => { if (laidOut) { letGo.current?.(); letGo.current = undefined; } }, [laidOut]);
  useLayoutEffect(() => () => { letGo.current?.(); letGo.current = undefined; }, []);
}

export interface LaidIsland { readonly story: string; readonly territories?: readonly TerritoryShare[] | undefined }

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
