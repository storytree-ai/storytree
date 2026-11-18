// Capability 6 · CI times.
import { ciTimesLines, type CiGoing } from "./lines.js";
import type { CiTimesReading } from "./reading.js";

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

export function renderCiTimes(reading: CiTimesReading, now = new Date(), going?: CiGoing): string {
  const lines = ciTimesLines(reading, now, going);
  const spark = `<span class="ci-times-spark" aria-hidden="true"><span class="ci-times-spark-before">${escape(lines.spark.before)}</span>${escape(lines.spark.week)}</span>`;
  return [
    `<span class="ci-times-item" data-ci-times="to-merge">${escape(lines.toMerge)} ${spark}${lines.was === "" ? "" : ` ${escape(lines.was)}`}</span>`,
    `<span class="ci-times-item" data-ci-times="run">${escape(lines.run)}</span>`,
    `<span class="ci-times-item" data-ci-times="queue">${escape(lines.queue)}</span>`,
    `<span class="ci-times-item" data-ci-times="going">${escape(lines.going)}</span>`,
  ].join("");
}

export interface CiTimesHost {
  hidden: boolean | string;
  innerHTML: string;
  title: string;
  readonly ownerDocument: {
    adoptedStyleSheets: Sheet[];
    readonly defaultView: { CSSStyleSheet: new () => Sheet } | null;
  };
}

interface Sheet {
  replaceSync(text: string): void;
}

export function mountCiTimes(host: CiTimesHost, { read, going = () => undefined, everyMs = READ_EVERY_MS, now = () => new Date() }: { read(): Promise<CiTimesReading | undefined>; going?: () => CiGoing | undefined; everyMs?: number; now?: () => Date }): { stop(): void } {
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
    const live = going();
    host.innerHTML = reading === undefined ? "" : renderCiTimes(reading, now(), live);
    host.title = reading === undefined ? "" : ciTimesLines(reading, now(), live).detail;
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
