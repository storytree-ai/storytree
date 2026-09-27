import { queueRun } from "../waits/waits.js";
import { boardView } from "../board/board.js";
import { readBoard, type BoardReads } from "../board/reads.js";
import { arcSmokeProblems, type ArcDrawn } from "../board/smoke.js";

/** The desktop supplies its page execution seam; the story owns what its smoke check asks. */
export async function smokeArcSurface(page: { executeJavaScript(code: string): Promise<unknown> }, project: string, reads: BoardReads): Promise<string[]> {
  const snapshot = await readBoard(project, reads);
  if (!snapshot.arcs.length) return [];
  const { lines } = await reads.linesSince(project, 0);
  await page.executeJavaScript(`(() => {
    const button = document.querySelector('[data-open-arcs]');
    if (!button) throw new Error('the arc surface is not mounted');
    button.click();
    return new Promise((resolve, reject) => {
      const end = Date.now() + 10000;
      const poll = () => {
        const surface = document.querySelector('.arc-overlay');
        if (surface?.dataset.arcState === 'ready') return resolve(true);
        if (Date.now() > end) return reject(new Error(surface?.innerText || 'the arc surface did not answer'));
        setTimeout(poll, 20);
      };
      poll();
    });
  })()`);
  const problems: string[] = [];
  for (const scope of ["active", "parked", "closed"] as const) {
    const drawn = await page.executeJavaScript(`(() => {
      document.querySelector('[data-arc-scope="${scope}"]').click();
      const closed = [...document.querySelectorAll('[data-arc-queue][aria-expanded="false"]')].map(button => button.dataset.arcQueue);
      for (const id of closed) {
        [...document.querySelectorAll('[data-arc-queue]')].find(button => button.dataset.arcQueue === id)?.click();
      }
      return JSON.parse(document.body.dataset.drew).arcSurface;
    })()`) as ArcDrawn;
    const board = boardView(snapshot, lines, new Date(), scope);
    const rows = new Set(board.queues.map(({ arc }) => arc.id));
    const chips = new Set(board.queues.flatMap((queue) => queueRun(queue).chips.map(({ id }) => id)));
    // A queue chip shows its title and counts on hover, not a second full row of bars.
    // Judge those actual chips and the root rows; a +N is not N drawn arcs.
    const visible = { ...board, lanes: board.lanes.filter(({ id }) => rows.has(id) || chips.has(id))
      .map((lane) => rows.has(lane.id) ? lane : { ...lane, bars: [] }) };
    problems.push(...arcSmokeProblems(visible, drawn));
  }
  await page.executeJavaScript(`document.querySelector('[data-arc-scope="active"]').click()`);
  return problems;
}
