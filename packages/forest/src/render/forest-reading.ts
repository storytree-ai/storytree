/**
 * The forest's reading: the arc surface's live reading, with the project's tree read again when the
 * library changed (and once at the start), handed on with the news that came with it.
 */
import { liveReading, type LiveReading, type LiveReads, type News, type Timers } from "@storytree/arc-surface";
import type { AnnotatedTree } from "@storytree/library";

/** The live reading's two reads and the project's tree: `window.storytree`'s. */
export interface ForestReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
}

export interface ForestReadingOptions {
  project: string;
  reads: ForestReads;
  /** Called with the tree and the news it was read for. */
  onTree(tree: AnnotatedTree, news: News): unknown;
  /** Called when a read fails. */
  onError(error: unknown): void;
  /** Called once a minute with the time. */
  onClock?(now: number): void;
  timers?: Timers;
}

/** Start reading project `project`'s forest live. */
export function forestReading({ project, reads, onTree, onError, onClock = () => {}, timers }: ForestReadingOptions): LiveReading {
  let tree: AnnotatedTree | undefined;
  let drawing = Promise.resolve();
  return liveReading({
    project,
    reads,
    timers,
    onNews: (news) => {
      drawing = drawing.then(async () => {
        if (tree === undefined || news.changes.length > 0) tree = await reads.projectTree(project);
        await onTree(tree, news);
      }).catch(onError);
    },
    onClock,
    onError,
  });
}
