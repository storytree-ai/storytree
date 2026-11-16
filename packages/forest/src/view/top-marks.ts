/**
 * Capability 3 · Story node render (the forest story): on an imported island drawn top-down, a capability inside a closed
 * top part has no territory of its own, so a mark keyed to it (a session's claim flag, the selected arc's ring, the selected
 * capability's gold ring) is drawn on the top part holding it, and stays keyed to the capability for when the part opens (3.121).
 * Once the part opens, the mark stands on the capability's own territory inside it, and the part carries none (3.122).
 */
import { Group, type Quaternion, type Vector3 } from "three";
import type { ClaimTint } from "@storytree/forest";
import { isTopPart } from "../render/top-parts.js";
import type { IslandRoads } from "../territories/island-roads.js";
import type { NestedLayout } from "../territories/nested-territories.js";
import type { Point } from "../territories/territories.js";
import { ClaimMarks } from "./claim-flag.js";
import { IslandOpenWork, openWorkMarks } from "./open-work.js";

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

/**
 * The claim flags, open-work rings and gold pick an opened top part's capabilities carry on its land (3.122): each on the
 * capability's own territory in the part's nested layout, placed about the layout's centre in the island's coordinates. A
 * capability opened into its code parts is no top part, so it draws none here: its own marks stay on the island.
 */
export class OpenedTopMarks {
  readonly root = new Group();
  private readonly flags = new ClaimMarks();
  private readonly work = new IslandOpenWork();
  private laid: { map: NestedLayout["map"]; onWork: (point: Point) => Vector3 } | undefined;

  constructor() {
    this.root.name = "opened-top-marks";
    this.root.add(this.flags.root, this.work.root);
  }

  /** Lays the marks on `capability`'s opened `layout`, placed by the island's `onLand` (flags) and `onWork` (rings); none unless it is a top part. */
  setLand(capability: string, layout: NestedLayout, onLand: (point: Point) => Vector3, onWork: (point: Point) => Vector3, normalAt: (point: Point) => Vector3): void {
    if (!isTopPart(capability)) { this.laid = undefined; return; }
    const about = (onSurface: (point: Point) => Vector3) => (p: Point) => onSurface({ x: p.x + layout.centre.x, z: p.z + layout.centre.z });
    this.laid = { map: layout.map, onWork: about(onWork) };
    this.flags.setLand(layout.map, about(onLand), normalAt, false);
  }

  /** Plants the flags of `claimed` on the capabilities inside, as the island's ClaimMarks does on its own. */
  claims(claimed: ReadonlyMap<string, ClaimTint>, now: number, how: { standing: boolean; reduced: boolean }): void {
    if (this.laid !== undefined) this.flags.claims(claimed, now, how);
  }

  /** Rings the capabilities inside that `circled` names, and the selected one (`picked`) in gold, by `roads` once routed, for an eye at `zoom`; the layers drawn anew. */
  rings(circled: ReadonlySet<string> | undefined, roads: IslandRoads | undefined, picked: string | undefined, zoom: number): Group[] {
    if (this.laid === undefined) return [];
    return this.work.show(openWorkMarks(this.laid.map, circled, roads, picked), this.laid.onWork, zoom);
  }

  /** Shows the flags and the rings, each by its own switch. */
  visible(flags: boolean, rings: boolean): void {
    this.flags.root.visible = flags;
    this.work.root.visible = rings;
  }

  /** Plays the flags and keeps the rings' width on screen at `zoom`; whether either wants another frame. */
  frame(now: number, { zoom, eye, reduced }: { zoom: number; eye: Quaternion; reduced: boolean }): boolean {
    if (this.laid === undefined) return false;
    const playing = this.flags.frame(now, { zoom, eye, reduced });
    return this.work.size(zoom * (this.work.root.matrixWorld.getMaxScaleOnAxis() || 1)) || playing;
  }

  /** Frees the flags and rings, once the part closes. */
  dispose(): void {
    this.flags.dispose();
    this.work.dispose();
  }
}
