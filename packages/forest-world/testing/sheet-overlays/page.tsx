// The drawing engine 4.35, mounted: two islands joined by one lane and a link to a capability on no island, which the lanes notice
// reports, on a sheet a host opens, closes and opens again; and 4.45, the same sheet opened by a host that shows the notice itself.
import { createRoot, type Root } from 'react-dom/client';
import type { ForestScene, Island } from '../../src/scene.js';
import { PlanetWorldCanvas, SHEET_RADIUS, sheetSpot, type LanesNotice } from '../../src/planet/PlanetWorldCanvas.js';

const R = SHEET_RADIUS, sheet = { width: 260, height: 160 };
const island = (story: string): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: [{ capability: `${story}1`, form: 'green', status: 'healthy', contracts: 1, x: 0, z: 0, scale: 1, turn: 0 }],
});
const scene: ForestScene = { islands: [island('a'), island('b')], links: [{ from: 'a1', to: 'b1' }, { from: 'a1', to: 'retired' }] };
const spots = new Map([['a', sheetSpot({ x: 60, y: 0 })], ['b', sheetSpot({ x: -60, y: 0 })]]);
const host = document.querySelector<HTMLElement>('#globe')!;
let root: Root | undefined;
const reported: (LanesNotice | undefined)[] = [];
const report = (notice: LanesNotice | undefined) => { reported.push(notice); };

(window as any).proof = {
  /** Open the sheet afresh, as a host's redraw does: a new root, so the canvas mounts again. */
  open() {
    root = createRoot(host);
    root.render(<PlanetWorldCanvas scene={scene} spots={spots} radius={R} sheet={sheet} lanes={[{ from: 'a1', to: 'b1', dir: 'up' }]} />);
  },
  /** Open it for a host that shows the lanes notice itself (4.45). */
  openReporting() {
    root = createRoot(host);
    root.render(<PlanetWorldCanvas scene={scene} spots={spots} radius={R} sheet={sheet} lanes={[{ from: 'a1', to: 'b1', dir: 'up' }]} onLanesNotice={report} />);
  },
  /** Each notice the canvas told its host, undefined for none, as `null`. */
  reported: () => reported.map(notice => notice === undefined ? null : { text: notice.text, issue: notice.issue.length > 0 }),
  close() { root?.unmount(); root = undefined; host.replaceChildren(); },
  /** The words of each notice laid over the sheet. */
  notices: () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map(notice => notice.textContent),
};
