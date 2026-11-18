import { createRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { Group } from 'three';
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

const globe = createRef<Group>();
let centre: [number, number, number] = [0, 0, 0];
let rerender: (() => void) | undefined;
function TurningHost() {
  const [, setRenders] = useState(0);
  rerender = () => setRenders(n => n + 1);
  return <PlanetWorldCanvas scene={scene} spots={spots} radius={R} sheet={sheet} globe={globe} offset={centre} />;
}
const turn = (to: [number, number, number]) => { centre = to; globe.current?.position.set(...to); };

(window as any).proof = {
  open() {
    root = createRoot(host);
    root.render(<PlanetWorldCanvas scene={scene} spots={spots} radius={R} sheet={sheet} lanes={[{ from: 'a1', to: 'b1', dir: 'up' }]} />);
  },
  openReporting() {
    root = createRoot(host);
    root.render(<PlanetWorldCanvas scene={scene} spots={spots} radius={R} sheet={sheet} lanes={[{ from: 'a1', to: 'b1', dir: 'up' }]} onLanesNotice={report} />);
  },
  reported: () => reported.map(notice => notice === undefined ? null : { text: notice.text, issue: notice.issue.length > 0 }),
  openTurning() {
    root = createRoot(host);
    root.render(<TurningHost />);
  },
  turnable: () => globe.current !== null,
  turnBetweenRenderAndCommit() {
    turn([0, 1, 0]);
    flushSync(() => rerender!());
    turn([0, 2, 0]);
  },
  centre: () => globe.current!.position.toArray(),
  close() { root?.unmount(); root = undefined; host.replaceChildren(); },
  notices: () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map(notice => notice.textContent),
};
