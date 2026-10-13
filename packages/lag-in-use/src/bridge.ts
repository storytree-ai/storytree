/** Capability 1 · Recorder. What crosses from the page to the app: a batch of readings, data only, safe in the sandboxed renderer. */

/** One catalogue action its user took, as the page measured it. Times are milliseconds. */
export interface LagReading {
  /** The catalogue's field name for the action (@storytree/forest/actions). */
  name: string;
  /** Input to the next paint: the longest Event Timing entry from the input until settled, 0 when none reached the browser's 16 ms. */
  response: number;
  /** Long Animation Frames (over 50 ms) from the input until settled: how many, and the longest (0 when none). */
  longFrames: number;
  longestFrame: number;
  /** Input to the page showing what the catalogue says settled looks like. */
  settled: number;
  /** A loading bar or circle was on show before it settled. */
  progress: boolean;
  /** How big the thing acted on was: for an island, how many capabilities its story has. */
  size?: number;
}

export interface LagBridge {
  recordLag(readings: LagReading[]): Promise<void>;
}

export const LAG_CHANNELS = { recordLag: "storytree:record-lag" } as const;

/** The page's side of this story's operations, named in its manifest (`pageChannels`, ADR-1021): the desktop's preload offers them. */
export const lagPageChannels = [LAG_CHANNELS];
