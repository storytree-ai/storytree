// Capability 3 · Surfaces
import type { ContextReading, LinesStart, SessionWindow } from "@storytree/session-management";
import type { AnnotatedTree, ArcView, BoardArcView, Changes, ChangesFilter, DayWindow, Holds, Line, LineKind, LinesSince, Note, PrCutover, SchemaRecord } from "@storytree/library";

import type { SurfaceReading } from "./switches.js";

export type SurfacesResult = { readonly ok: true; readonly value: readonly SurfaceReading[] } | { readonly ok: false; readonly error: string };

export interface SurfacesBridge {
  readSurfaces(): Promise<SurfacesResult>;
  saveSurface(words: readonly string[]): Promise<SurfacesResult>;
}

export const SURFACES_CHANNELS = {
  readSurfaces: "storytree:read-surfaces",
  saveSurface: "storytree:save-surface",
} as const;

export interface PageReadsBridge {
  arcViews(name: string): Promise<ArcView[]>;
  boardArcs(name: string, closed: DayWindow): Promise<BoardArcView[]>;
  closedArcs(name: string, window: DayWindow): Promise<BoardArcView[]>;
  holds(name: string): Promise<Holds>;
  prCutover(name: string): Promise<PrCutover | undefined>;
  projectTree(name: string): Promise<AnnotatedTree>;
  changesSince(name: string, cursor: number, filter?: ChangesFilter): Promise<Changes>;
  linesSince(name: string, cursor: number): Promise<LinesSince>;
  linesStart?(name: string, kinds: readonly LineKind[]): Promise<LinesStart>;
  sessionLines?(name: string, sessions: readonly string[]): Promise<Line[]>;
  inherited(name: string): Promise<SchemaRecord[]>;
  frontCovers(name: string, nodeId: string): Promise<SchemaRecord<"decision">[]>;
  relatedNotes(name: string, noteId: string): Promise<Note[]>;
  standingDelegations(name: string): Promise<string | undefined>;
  contextReadings(name: string, sessions: readonly string[]): Promise<ContextReading[]>;
  idleAfterMs(): Promise<number>;
  leaveAfterMs(): Promise<number>;
  windowReading(name: string, session: string): Promise<SessionWindow>;
}

export const PAGE_READS_CHANNELS = {
  arcViews: "storytree:arc-views",
  boardArcs: "storytree:board-arcs",
  closedArcs: "storytree:closed-arcs",
  holds: "storytree:holds",
  prCutover: "storytree:pr-cutover",
  projectTree: "storytree:project-tree",
  changesSince: "storytree:changes-since",
  linesSince: "storytree:lines-since",
  linesStart: "storytree:lines-start",
  sessionLines: "storytree:session-lines",
  inherited: "storytree:inherited",
  frontCovers: "storytree:front-covers",
  relatedNotes: "storytree:related-notes",
  standingDelegations: "storytree:standing-delegations",
  contextReadings: "storytree:context-readings",
  idleAfterMs: "storytree:idle-after-ms",
  leaveAfterMs: "storytree:leave-after-ms",
  windowReading: "storytree:window-reading",
} as const;

export function surfaceSetting(readings: readonly SurfaceReading[], id: string, setting: string): string | undefined {
  return readings.find((surface) => surface.id === id)?.settings.find((each) => each.id === setting)?.value;
}

export function surfaceOn(readings: readonly SurfaceReading[], id: string): boolean {
  return readings.find((surface) => surface.id === id)?.on ?? true;
}
