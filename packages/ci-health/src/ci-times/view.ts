/**
 * Capability 6 · CI times. The map's bottom-left strip (stage 1 of question_177bdb4c1e2a's display): the factory's CI
 * averages as four small dim figures on one line, read when wanted and never asking for attention (ADR-0853 P2). One line
 * low enough to sit in the band the map opens with clear below its south edge (forest's sheet-navigation CLEAR_BOTTOM,
 * 45 px), so at rest it covers no island or name; a block of four lines covered the southmost island. Its hover says what
 * each figure is. With nothing recorded there is no strip. It reads again every minute while it is mounted; the app records
 * again behind that read once the last recording is ten minutes old (runtime.ts).
 */
import { ciTimesLines } from "./lines.js";
import type { CiTimesReading } from "./reading.js";

/** How often the strip reads again while mounted. */
export const READ_EVERY_MS = 60 * 1000;

const STYLES = `
.ci-times { position: absolute; left: calc(var(--rail-width, 0px) + 12px); bottom: 8px; z-index: 2; margin: 0; padding: 2px 8px;
  max-width: calc(100% - var(--rail-width, 0px) - 72px); box-sizing: border-box; display: flex; overflow: hidden;
  border-radius: 5px; background: rgb(16 20 24 / .95); color: #8d9693; font: 11px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace;
  white-space: pre; pointer-events: auto; user-select: none; }
.ci-times[hidden] { display: none; }
/* A narrow map cuts the last figures first: the live count, then the queue's, and so on; the first gives way last. */
.ci-times-item { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ci-times-item:nth-child(1) { flex-shrink: 0.01; }
.ci-times-item:nth-child(2) { flex-shrink: 0.1; }
.ci-times-item:nth-child(3) { flex-shrink: 1; }
.ci-times-item:nth-child(4) { flex-shrink: 10; }
.ci-times-item + .ci-times-item::before { content: "·"; margin: 0 7px; opacity: .5; }
.ci-times-spark { letter-spacing: 1px; color: #a9b3af; }
.ci-times-spark-before { opacity: .45; }
`;

const escape = (text: string) => text.replace(/[&<>"]/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[one]!);

/** The strip's inner markup for `reading` as of `now`: its four figures. */
export function renderCiTimes(reading: CiTimesReading, now = new Date()): string {
  const lines = ciTimesLines(reading, now);
  const spark = `<span class="ci-times-spark" aria-hidden="true"><span class="ci-times-spark-before">${escape(lines.spark.before)}</span>${escape(lines.spark.week)}</span>`;
  return [
    `<span class="ci-times-item" data-ci-times="to-merge">${escape(lines.toMerge)} ${spark}${lines.was === "" ? "" : ` ${escape(lines.was)}`}</span>`,
    `<span class="ci-times-item" data-ci-times="run">${escape(lines.run)}</span>`,
    `<span class="ci-times-item" data-ci-times="queue">${escape(lines.queue)}</span>`,
    `<span class="ci-times-item" data-ci-times="going">${escape(lines.going)}</span>`,
  ].join("");
}

/** The element the strip is drawn in, as the page gives it: only what the strip sets. */
export interface CiTimesHost {
  // A page element's `hidden` may also read "until-found"; the strip only sets it true or false.
  hidden: boolean | string;
  innerHTML: string;
  title: string;
  readonly ownerDocument: {
    adoptedStyleSheets: Sheet[];
    readonly defaultView: { CSSStyleSheet: new () => Sheet } | null;
  };
}

/** A constructed stylesheet: the page's policy takes no inline style element, so the strip's styles are adopted, as the feedback corner's are. */
interface Sheet {
  replaceSync(text: string): void;
}

/**
 * Draw the CI times in `host` and keep them current: `read` gives the reading (the page's bridge), every `everyMs`. A read
 * that fails leaves the strip as it was. Stopping clears the timer; the page removes the host.
 */
export function mountCiTimes(host: CiTimesHost, { read, everyMs = READ_EVERY_MS, now = () => new Date() }: { read(): Promise<CiTimesReading | undefined>; everyMs?: number; now?: () => Date }): { stop(): void } {
  const document = host.ownerDocument;
  const sheet = new document.defaultView!.CSSStyleSheet();
  sheet.replaceSync(STYLES);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  host.hidden = true;
  let stopped = false;
  const draw = async () => {
    const reading = await read().catch(() => null);
    if (stopped || reading === null) return;
    host.hidden = reading === undefined;
    host.innerHTML = reading === undefined ? "" : renderCiTimes(reading, now());
    host.title = reading === undefined ? "" : ciTimesLines(reading, now()).detail;
  };
  void draw();
  const timer = setInterval(() => void draw(), everyMs);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((one) => one !== sheet);
    },
  };
}
