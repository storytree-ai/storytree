// Capability 6 · Readings file
import { LAG_CHANNELS, type LagBridge } from "./bridge.js";
import { appendReadings, isReading, storytreeHome } from "./readings.js";

export function createLagRuntime(options: { home?: string; appVersion: string; now?: () => number }): LagBridge {
  const home = options.home ?? storytreeHome();
  let writing: Promise<void> = Promise.resolve();
  return {
    recordLag(readings: unknown) {
      const kept = (Array.isArray(readings) ? readings.filter(isReading) : []).map(({ name, response, longFrames, longestFrame, settled, progress, size, frames }) =>
        ({ name, response, longFrames, longestFrame, settled, progress, ...(size === undefined ? {} : { size }),
          ...(frames === undefined ? {} : { frames: { p50: frames.p50, p95: frames.p95, max: frames.max, over: frames.over } }) }));
      writing = writing.then(() => appendReadings(home, kept, { version: options.appVersion, now: (options.now ?? Date.now)() }))
        .catch(() => { });
      return writing;
    },
  };
}

export interface LagPageFrame {
  readonly home: string;
  readonly appVersion: string;
}

export const lagPageAnswers = [(frame: LagPageFrame) => ({ channels: LAG_CHANNELS, answers: createLagRuntime({ home: frame.home, appVersion: frame.appVersion }) })];
