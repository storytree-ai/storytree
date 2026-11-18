// Capability 5 · Recorder

export interface LagReading {
  name: string;
  response: number;
  longFrames: number;
  longestFrame: number;
  settled: number;
  progress: boolean;
  size?: number;
  frames?: TurnFrames;
}

export type TurnFrames = { p50: number; p95: number; max: number; over: number };

export interface LagBridge {
  recordLag(readings: LagReading[]): Promise<void>;
}

export const LAG_CHANNELS = { recordLag: "storytree:record-lag" } as const;

export const lagPageChannels = [LAG_CHANNELS];
