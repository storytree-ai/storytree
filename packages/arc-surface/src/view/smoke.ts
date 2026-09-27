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
      return JSON.parse(document.querySelector('.arc-overlay').dataset.drew);
    })()`) as ArcDrawn;
    problems.push(...arcSmokeProblems(boardView(snapshot, lines, new Date(), scope), drawn));
  }
  await page.executeJavaScript(`document.querySelector('[data-arc-scope="active"]').click()`);
  return problems;
}
