/**
 * The forest's reading: the arc surface's live reading, with the project's tree read again when the
 * library changed (and once at the start), handed on with the news that came with it, and the survey
 * of its code (capability 8), when the host can read the code. The tree never waits for the survey:
 * it is drawn with the last survey, and drawn again when a newer one lands (ADR-0836 D2).
 */
import { ASK_EVERY_MS, pageReading, type LiveReading, type LiveReads, type News, type PageReading, type Timers } from "@storytree/arc-surface";
import type { AnnotatedTree } from "@storytree/library";

import type { StorySurvey } from "../code-survey/code-survey.js";

/** The live reading's two reads and the project's tree: `window.storytree`'s. */
export interface ForestReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  /** Each story's code survey, by story id. A host that cannot read the code has none, and the islands have no territories. */
  codeSurvey?(project: string): Promise<Readonly<Record<string, StorySurvey>>>;
}

export interface ForestReadingOptions {
  project: string;
  reads: ForestReads;
  /** Called with the tree, the news it was read for and the code's survey; a failure here is retried like a failed read. */
  onTree(tree: AnnotatedTree, news: News, survey: Readonly<Record<string, StorySurvey>>): unknown;
  /** Called when a read fails; the next ask tries again. */
  onError(error: unknown): void;
  /** Called once a minute with the time. */
  onClock?(now: number): void;
  timers?: Timers;
  /** The page's one live reading, which the forest hears; without it the forest reads for itself. */
  reading?: PageReading;
}

/** How often, at most, the code is surveyed again: the land may lag the checkout by this much (ADR-0836 D2). */
export const SURVEY_EVERY_MS = 10_000;

type Survey = Readonly<Record<string, StorySurvey>>;

/**
 * The survey's pacing: `want` asks for a survey; one runs at a time, at most every SURVEY_EVERY_MS, and
 * an ask in between runs once that time has passed, so the land converges on the checkout. A survey
 * that fails is asked again.
 */
function surveyPacing(read: () => Promise<Survey>, landed: (survey: Survey) => void, timers: Timers): { want(): void; stop(): void } {
  let wanted = false;
  let running = false;
  let last = -Infinity;
  const run = (): void => {
    if (!wanted || running || timers.now() - last < SURVEY_EVERY_MS) return;
    wanted = false;
    running = true;
    last = timers.now();
    read().then(landed, () => { wanted = true; }).finally(() => { running = false; });
  };
  const stop = timers.every(ASK_EVERY_MS, run);
  return { want() { wanted = true; run(); }, stop };
}

const pageTimers: Timers = {
  now: () => Date.now(),
  every(ms, run) {
    const handle = setInterval(run, ms);
    return () => clearInterval(handle);
  },
};

/**
 * Start reading project `project`'s forest live. A failed read, of the news or of the tree, is
 * reported and asked again from the same place at the next ask, so a first read that fails is drawn
 * once the library answers. The live reading takes one news at a time, in order, so a slow tree read
 * never draws over a newer one.
 */
export function forestReading({ project, reads, onTree, onError, onClock = () => {}, timers = pageTimers, reading: page }: ForestReadingOptions): LiveReading {
  let tree: AnnotatedTree | undefined;
  let survey: Survey = {};
  let stopped = false;
  // A survey that lands draws the last tree again, unless it changes nothing on show (ADR-0836 D1).
  const pacing = surveyPacing(() => reads.codeSurvey!(project), (next) => {
    if (stopped || JSON.stringify(next) === JSON.stringify(survey)) return;
    survey = next;
    if (tree !== undefined) Promise.resolve(onTree(tree, { changes: [], lines: [] }, survey)).catch(onError);
  }, timers);
  const own = page === undefined ? pageReading({ project, reads, timers }) : undefined;
  const stopHearing = (page ?? own!).subscribe({
    onNews: async (news) => {
      if (tree === undefined || news.changes.length > 0) {
        tree = await reads.projectTree(project);
        if (reads.codeSurvey !== undefined) pacing.want();
      }
      await onTree(tree, news, survey);
    },
    onClock,
    onError,
  });
  return {
    stop() {
      stopped = true;
      pacing.stop();
      stopHearing();
      own?.stop();
    },
  };
}
