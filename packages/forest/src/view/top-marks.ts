// Capability 3 · Story node render
import { Group, type Quaternion, type Vector3 } from "three";
import type { ClaimTint } from "@storytree/forest";
import { isTopPart } from "../render/top-parts.js";
import type { IslandRoads } from "../territories/island-roads.js";
import type { NestedLayout } from "../territories/nested-territories.js";
import type { Point } from "../territories/territories.js";
import { ClaimMarks } from "./claim-flag.js";
import { IslandOpenWork, openWorkMarks } from "./open-work.js";

export function memberTops(parts: readonly { readonly capability: string; readonly shares: readonly { readonly capability?: string }[] }[]): Map<string, string> {
  return new Map(parts.flatMap(({ capability: top, shares }) => !isTopPart(top) ? []
    : shares.flatMap(({ capability }) => capability === undefined ? [] : [[capability, top] as const])));
}

export function rolledToTops<V>(marked: ReadonlyMap<string, V>, tops: ReadonlyMap<string, string>): Map<string, V>;
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

export const pickedOnTops = (picked: string | undefined, tops: ReadonlyMap<string, string>): string | undefined =>
  picked === undefined ? undefined : tops.get(picked) ?? picked;

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

export class OpenedTopMarks {
  readonly root = new Group();
  private readonly flags = new ClaimMarks();
  private readonly work = new IslandOpenWork();
  private laid: { map: NestedLayout["map"]; onWork: (point: Point) => Vector3 } | undefined;

  constructor() {
    this.root.name = "opened-top-marks";
    this.root.add(this.flags.root, this.work.root);
  }

  setLand(capability: string, layout: NestedLayout, onLand: (point: Point) => Vector3, onWork: (point: Point) => Vector3, normalAt: (point: Point) => Vector3): void {
    if (!isTopPart(capability)) { this.laid = undefined; return; }
    const about = (onSurface: (point: Point) => Vector3) => (p: Point) => onSurface({ x: p.x + layout.centre.x, z: p.z + layout.centre.z });
    this.laid = { map: layout.map, onWork: about(onWork) };
    this.flags.setLand(layout.map, about(onLand), normalAt, false);
  }

  claims(claimed: ReadonlyMap<string, ClaimTint>, now: number, how: { standing: boolean; reduced: boolean }): void {
    if (this.laid !== undefined) this.flags.claims(claimed, now, how);
  }

  rings(circled: ReadonlySet<string> | undefined, roads: IslandRoads | undefined, picked: string | undefined, zoom: number): Group[] {
    if (this.laid === undefined) return [];
    return this.work.show(openWorkMarks(this.laid.map, circled, roads, picked), this.laid.onWork, zoom);
  }

  visible(flags: boolean, rings: boolean): void {
    this.flags.root.visible = flags;
    this.work.root.visible = rings;
  }

  frame(now: number, { zoom, eye, reduced }: { zoom: number; eye: Quaternion; reduced: boolean }): boolean {
    if (this.laid === undefined) return false;
    const playing = this.flags.frame(now, { zoom, eye, reduced });
    return this.work.size(zoom * (this.work.root.matrixWorld.getMaxScaleOnAxis() || 1)) || playing;
  }

  dispose(): void {
    this.flags.dispose();
    this.work.dispose();
  }
}
