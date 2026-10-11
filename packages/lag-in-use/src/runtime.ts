/**
 * Capability 2 · Readings file. The app's side of the bridge: the main process keeps each batch the page sends, checked and stamped
 * with the app's version, one batch after another so two never interleave. Keeping them never fails the page.
 */
import type { LagBridge } from "./bridge.js";
import { appendReadings, isReading, storytreeHome } from "./readings.js";

export function createLagRuntime(options: { home?: string; appVersion: string; now?: () => number }): LagBridge {
  const home = options.home ?? storytreeHome();
  let writing: Promise<void> = Promise.resolve();
  return {
    recordLag(readings: unknown) {
      // Only a reading's own fields are kept, whatever else the page sent.
      const kept = (Array.isArray(readings) ? readings.filter(isReading) : []).map(({ name, response, longFrames, longestFrame, settled, progress, size }) =>
        ({ name, response, longFrames, longestFrame, settled, progress, ...(size === undefined ? {} : { size }) }));
      writing = writing.then(() => appendReadings(home, kept, { version: options.appVersion, now: (options.now ?? Date.now)() }))
        .catch(() => { /* Observation never breaks the app it observes. */ });
      return writing;
    },
  };
}
