/**
 * Capability 3 · Story node render (the forest story): on an imported island drawn top-down, a capability inside a closed
 * top part has no territory of its own, so a mark keyed to it (a session's claim flag, the selected arc's ring, the selected
 * capability's gold ring) is drawn on the top part holding it, and stays keyed to the capability for when the part opens (3.121).
 * Once the part opens, the mark stands on the capability's own territory inside it, and the part carries none (3.122).
 */
import { isTopPart } from "../render/top-parts.js";

/** Each capability inside a top part, to that top part's id, from a scene's parts. */
export function memberTops(parts: readonly { readonly capability: string; readonly shares: readonly { readonly capability?: string }[] }[]): Map<string, string> {
  return new Map(parts.flatMap(({ capability: top, shares }) => !isTopPart(top) ? []
    : shares.flatMap(({ capability }) => capability === undefined ? [] : [[capability, top] as const])));
}

/** `marked`, with each top part holding a marked capability marked too, as the first of them is (in `marked`'s order). */
export function rolledToTops<V>(marked: ReadonlyMap<string, V>, tops: ReadonlyMap<string, string>): Map<string, V>;
/** `marked`, with each top part holding a marked capability marked too; undefined stays undefined. */
export function rolledToTops(marked: ReadonlySet<string> | undefined, tops: ReadonlyMap<string, string>): ReadonlySet<string> | undefined;
export function rolledToTops<V>(marked: ReadonlyMap<string, V> | ReadonlySet<string> | undefined, tops: ReadonlyMap<string, string>): Map<string, V> | ReadonlySet<string> | undefined {
  if (marked === undefined) return undefined;
  if (marked instanceof Set) return new Set([...marked, ...[...marked].flatMap((capability) => tops.get(capability) ?? [])]);
  const rolled = new Map(marked as ReadonlyMap<string, V>);
  for (const [capability, value] of marked as ReadonlyMap<string, V>) {
    const top = tops.get(capability);
    if (top !== undefined && !rolled.has(top)) rolled.set(top, value);
  }
  return rolled;
}

/** Where the selected capability's gold ring is drawn on a closed island: on the top part holding it, else on itself. */
export const pickedOnTops = (picked: string | undefined, tops: ReadonlyMap<string, string>): string | undefined =>
  picked === undefined ? undefined : tops.get(picked) ?? picked;

/** `marked` beside `open`, the part open on the map: an opened top part carries none of its capabilities' marks, which stand
 * on their own territories inside it (3.122); a capability opened into its code parts keeps its own. */
export function besideOpen<V>(marked: ReadonlyMap<string, V>, open: string | undefined): ReadonlyMap<string, V>;
export function besideOpen(marked: ReadonlySet<string> | undefined, open: string | undefined): ReadonlySet<string> | undefined;
export function besideOpen(marked: string | undefined, open: string | undefined): string | undefined;
export function besideOpen<V>(marked: ReadonlyMap<string, V> | ReadonlySet<string> | string | undefined, open: string | undefined): ReadonlyMap<string, V> | ReadonlySet<string> | string | undefined {
  if (marked === undefined || open === undefined || !isTopPart(open)) return marked;
  if (typeof marked === "string") return marked === open ? undefined : marked;
  if (!marked.has(open)) return marked;
  if (marked instanceof Set) return new Set([...marked].filter((id) => id !== open));
  return new Map([...(marked as ReadonlyMap<string, V>)].filter(([id]) => id !== open));
}
