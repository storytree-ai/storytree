/**
 * Capability 6 · Readings file. The app's side of the bridge: the main process keeps each batch the page sends, checked and stamped
 * with the app's version, one batch after another so two never interleave. Keeping them never fails the page.
 */
import { LAG_CHANNELS, type LagBridge } from "./bridge.js";
import { appendReadings, isReading, storytreeHome } from "./readings.js";

export function createLagRuntime(options: { home?: string; appVersion: string; now?: () => number }): LagBridge {
  const home = options.home ?? storytreeHome();
  let writing: Promise<void> = Promise.resolve();
  return {
    recordLag(readings: unknown) {
      // Only a reading's own fields are kept, whatever else the page sent.
      const kept = (Array.isArray(readings) ? readings.filter(isReading) : []).map(({ name, response, longFrames, longestFrame, settled, progress, size, frames }) =>
        ({ name, response, longFrames, longestFrame, settled, progress, ...(size === undefined ? {} : { size }),
          ...(frames === undefined ? {} : { frames: { p50: frames.p50, p95: frames.p95, max: frames.max, over: frames.over } }) }));
      writing = writing.then(() => appendReadings(home, kept, { version: options.appVersion, now: (options.now ?? Date.now)() }))
        .catch(() => { /* Observation never breaks the app it observes. */ });
      return writing;
    },
  };
}

/** What a host offers this story's page part: the app's home and the version its readings are stamped with. */
export interface LagPageFrame {
  readonly home: string;
  readonly appVersion: string;
}

/** The main process's side, named in its manifest (`pageAnswers`, ADR-1021): the desktop answers the page's readings with it. */
export const lagPageAnswers = [(frame: LagPageFrame) => ({ channels: LAG_CHANNELS, answers: createLagRuntime({ home: frame.home, appVersion: frame.appVersion }) })];
