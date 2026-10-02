// Type-only: browsers never import refresh/database code.
import type { Line } from "@storytree/agent-link";
import type { AnnotatedTree, ArcView, Change, Holds } from "@storytree/library";
import type { StoryNode } from "@storytree/forest";
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
