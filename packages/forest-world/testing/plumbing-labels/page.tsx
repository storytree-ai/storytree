// The drawing engine 4.35, mounted: two islands joined by one plumbing road, on a sheet a host opens, closes and opens again.
import { createRoot, type Root } from 'react-dom/client';
import type { ForestScene, Island } from '../../src/scene.js';
import { PlanetWorldCanvas, SHEET_RADIUS, sheetSpot } from '../../src/planet/PlanetWorldCanvas.js';

const R = SHEET_RADIUS, sheet = { width: 260, height: 160 };
const island = (story: string): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: [{ capability: `${story}1`, form: 'green', status: 'healthy', contracts: 1, x: 0, z: 0, scale: 1, turn: 0 }],
});
const scene: ForestScene = { islands: [island('a'), island('b')], links: [], plumbing: [{ from: 'a', to: 'b', kind: 'build step', files: ['a/build.ts'] }] };
const spots = new Map([['a', sheetSpot({ x: 60, y: 0 })], ['b', sheetSpot({ x: -60, y: 0 })]]);
const host = document.querySelector<HTMLElement>('#globe')!;
let root: Root | undefined;

(window as any).proof = {
  /** Open the sheet afresh, as a host's redraw does: a new root, so the canvas mounts again. */
  open() {
    root = createRoot(host);
    root.render(<PlanetWorldCanvas scene={scene} spots={spots} radius={R} sheet={sheet} />);
  },
  close() { root?.unmount(); root = undefined; host.replaceChildren(); },
  /** Each plumbing label's words on the page. */
  labels: () => [...document.querySelectorAll<HTMLElement>('[data-plumbing]')].map(label => label.textContent),
};
