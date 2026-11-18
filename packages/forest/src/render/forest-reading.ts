// Capability 7 · Running sessions
import { ASK_EVERY_MS, pageReading, type LiveReading, type LiveReads, type News, type PageReading, type Timers } from "@storytree/arc-surface";
import type { AnnotatedTree } from "@storytree/library";

import type { StorySurvey } from "@storytree/library";

import type { ForestBridge, ForestPin } from "./page.js";

export interface ForestReads extends LiveReads {
  projectTree(project: string): Promise<AnnotatedTree>;
  codeSurvey?: ForestBridge["codeSurvey"];
  pins?: ForestBridge["pins"];
}

export interface ForestReadingOptions {
  project: string;
  reads: ForestReads;
  onTree(tree: AnnotatedTree, news: News, survey: Readonly<Record<string, StorySurvey>>, pins: readonly ForestPin[]): unknown;
  onError(error: unknown): void;
  onClock?(now: number): void;
  onSettled?(): void;
  timers?: Timers;
  reading?: PageReading;
  survey?: Readonly<Record<string, StorySurvey>>;
}

export const SURVEY_EVERY_MS = 10_000;

type Survey = Readonly<Record<string, StorySurvey>>;

function surveyPacing(read: () => Promise<Survey>, landed: (survey: Survey) => unknown, failed: () => void, timers: Timers): { want(): void; again(): void; stop(): void } {
  let wanted = false;
  let running = false;
  let last = -Infinity;
  const run = (): void => {
    if (!wanted || running || timers.now() - last < SURVEY_EVERY_MS) return;
    wanted = false;
    running = true;
    last = timers.now();
    read().then(landed, () => { wanted = true; failed(); }).finally(() => { running = false; run(); });
  };
  const stop = timers.every(ASK_EVERY_MS, run);
  return { want() { wanted = true; run(); }, again() { wanted = true; last = -Infinity; run(); }, stop };
}

const pageTimers: Timers = {
  now: () => Date.now(),
  every(ms, run) {
    const handle = setInterval(run, ms);
    return () => clearInterval(handle);
  },
};

const TREE_TYPES: ReadonlySet<string> = new Set(["story", "capability", "contract", "arc", "health"]);

type TreeNewsChange = { readonly type: string; readonly recordId?: string; readonly action?: string; readonly record?: { readonly fields?: unknown } };

function changesTree(news: { readonly changes: readonly TreeNewsChange[] }, last: AnnotatedTree): boolean {
  let listed: Set<string> | undefined;
  const movesOpenWork = (change: TreeNewsChange): boolean => {
    if (change.type !== "increment") return false;
    const fields = change.record?.fields as { capabilities?: readonly string[]; links?: readonly string[] } | undefined;
    if ((fields?.capabilities ?? []).length > 0 || (fields?.links ?? []).length > 0) return true;
    listed ??= new Set(last.stories.flatMap((story) => story.capabilities.flatMap((capability) => (capability.openWork ?? []).map(({ increment }) => increment))));
    return change.recordId !== undefined && listed.has(change.recordId);
  };
  let shown: Map<string, string> | undefined;
  const unchangedHealth = (change: TreeNewsChange): boolean => {
    if (change.type !== "health" || change.action === "retired") return false;
    const { node, column, state } = (change.record?.fields ?? {}) as { node?: string; column?: string; state?: string };
    shown ??= new Map(last.stories.flatMap((story) => story.capabilities.flatMap((capability) => capability.contracts.flatMap((contract) =>
      Object.entries(contract.health ?? {}).map(([name, entry]) => [`${contract.id} ${name}`, (entry as { state?: string }).state ?? ""] as const)))));
    return state !== undefined && shown.get(`${node} ${column}`) === state;
  };
  return news.changes.some((change) => (TREE_TYPES.has(change.type) && !unchangedHealth(change)) || movesOpenWork(change));
}

function landsCode(news: News): boolean {
  return news.lines.some((line) => line.kind === "merged" || (line.kind === "closed" && line.disposition === "landed"))
    || news.changes.some((change) => {
      if (change.type !== "increment" || change.action === "retired") return false;
      const fields = change.record.fields as { status?: string; outcome?: { disposition?: string } };
      return fields.status === "closed" && fields.outcome?.disposition === "landed";
    });
}

export async function treeAfter(reads: Pick<ForestReads, "projectTree">, project: string,
  news: { readonly changes: readonly TreeNewsChange[] }, last: AnnotatedTree | undefined): Promise<AnnotatedTree> {
  return last !== undefined && !changesTree(news, last) ? last : reads.projectTree(project);
}

export function forestReading({ project, reads, onTree, onError, onClock = () => {}, onSettled = () => {}, timers = pageTimers, reading: page, survey: kept = {} }: ForestReadingOptions): LiveReading {
  let tree: AnnotatedTree | undefined;
  let survey: Survey = kept;
  let pins: readonly ForestPin[] = [];
  let stopped = false;
  const start = { drawn: false, surveyed: reads.codeSurvey === undefined, settled: false };
  const settleStart = (): void => {
    if (stopped || start.settled || !start.drawn || !start.surveyed) return;
    start.settled = true;
    onSettled();
  };
  const surveyed = (): void => {
    start.surveyed = true;
    settleStart();
  };
  let askedAgain = false;
  let pinsAsked = 0;
  const readPins = (): void => {
    if (reads.pins === undefined) return;
    const asked = ++pinsAsked;
    reads.pins(project).then(async (next) => {
      if (stopped || asked !== pinsAsked || JSON.stringify(next) === JSON.stringify(pins)) return;
      pins = next;
      if (tree !== undefined) await onTree(tree, { changes: [], lines: [] }, survey, pins);
    }).catch(onError);
  };
  const pacing = surveyPacing(() => reads.codeSurvey!(project), async (next) => {
    if (stopped) return;
    if (JSON.stringify(next) !== JSON.stringify(survey)) {
      survey = next;
      if (tree !== undefined) await Promise.resolve(onTree(tree, { changes: [], lines: [] }, survey, pins)).catch(onError);
    }
    surveyed();
    readPins();
    if (!askedAgain) {
      askedAgain = true;
      pacing.again();
    }
  }, surveyed, timers);
  const own = page === undefined ? pageReading({ project, reads, timers }) : undefined;
  const stopHearing = (page ?? own!).subscribe({
    onNews: async (news) => {
      let refreshSurvey = landsCode(news);
      const pinsMoved = tree === undefined || news.changes.some((change) => change.type === "pin");
      if (pinsMoved) readPins();
      if (tree === undefined || changesTree(news, tree)) {
        tree = await reads.projectTree(project);
        refreshSurvey = true;
      }
      if (stopped) return;
      if (reads.codeSurvey !== undefined && refreshSurvey) pacing.want();
      await onTree(tree, news, survey, pins);
      start.drawn = true;
      settleStart();
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
