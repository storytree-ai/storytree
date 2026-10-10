// Capability 3 · Saved snapshot. Type-only: browsers never import refresh/database code.
import type { Line } from "@storytree/session-management";
import type { AnnotatedTree, ArcView, Change, Holds } from "@storytree/library";
import type { SessionWisp, StoryNode } from "@storytree/forest";
import type { ForestSnapshot } from "@storytree/forest/snapshot";
export type { ForestSnapshot };

export type PublicActivity<T = Line> = T extends object ? { [K in keyof T as K extends "folder" | "machine" | "transcript" | "branch" | "task" ? never : K]: PublicActivity<T[K]> } : T;

/** The saved public reading, extended under ADR-0852 D4. */
export interface TourSnapshot extends ForestSnapshot {
  project: string;
  places: StoryNode[];
  tree: AnnotatedTree;
  changes: Change[];
  arcs: ArcView[];
  holds: Holds;
  // Private optional fields and merged.branch are removed for publication.
  recording: { window: { from: string; to: string }; lines: PublicActivity[] };
}

/** A project's saved growth (ADR-0879 D7): its full plan's drawing, and each recorded stage's, dated. */
export interface GrowthSnapshot extends ForestSnapshot {
  project: string;
  window: { from: string; to: string };
  places: StoryNode[];
  titles: Record<string, string>;
  stages: { id: string; at: string; scene: ForestSnapshot["scene"]; wisps: SessionWisp[]; counts: { stories: number; capabilities: number; contracts: number } }[];
  /** The dated notes its knowledge core grows from; a growth saved before they were kept has none. */
  changes?: Change[];
  /** Its public reading, for free play's story panels, arcs and sessions; a growth saved without its arcs has none. */
  reading?: Pick<TourSnapshot, "tree" | "arcs" | "holds" | "recording">;
}
