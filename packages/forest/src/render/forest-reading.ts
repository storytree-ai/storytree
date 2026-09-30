/**
 * The forest's reading: the arc surface's live reading, with the project's tree read again when the
 * library changed (and once at the start), handed on with the news that came with it, and the survey
 * of its code read with it (capability 8), when the host can read the code.
 */
import { liveReading, type LiveReading, type LiveReads, type News, type Timers } from "@storytree/arc-surface";
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
}

/**
 * Start reading project `project`'s forest live. A failed read, of the news or of the tree, is
 * reported and asked again from the same place at the next ask, so a first read that fails is drawn
 * once the library answers. The live reading takes one news at a time, in order, so a slow tree read
 * never draws over a newer one.
 */
export function forestReading({ project, reads, onTree, onError, onClock = () => {}, timers }: ForestReadingOptions): LiveReading {
  let tree: AnnotatedTree | undefined;
  let survey: Readonly<Record<string, StorySurvey>> = {};
  return liveReading({
    project,
    reads,
    ...(timers === undefined ? {} : { timers }),
    onNews: async (news) => {
      if (tree === undefined || news.changes.length > 0) {
        tree = await reads.projectTree(project);
        // The code is read when the tree is: a survey that fails leaves the land as it was, never the forest unread.
        survey = (await reads.codeSurvey?.(project).catch(() => undefined)) ?? survey;
      }
      await onTree(tree, news, survey);
    },
    onClock,
    onError,
  });
}
