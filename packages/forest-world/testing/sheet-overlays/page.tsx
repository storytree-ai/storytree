// The drawing engine 4.35, mounted: two islands joined by one lane and a link to a capability on no island, which the lanes notice
// reports, on a sheet a host opens, closes and opens again; 4.45, the same sheet opened by a host that shows the notice itself;
// and 4.47, a host that turns the big sphere through its group, as the forest's sheet does.
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

// 4.47: the host keeps its pose outside React, sets it on the group as it turns, and passes the same pose whenever it renders.
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
  /** Open the sheet for a host that turns the big sphere through its group (4.47). */
  openTurning() {
    root = createRoot(host);
    root.render(<TurningHost />);
  },
  /** Whether the group has been made. */
  turnable: () => globe.current !== null,
  /** The host renders at one pose, then turns the group on before the canvas has committed that render: the last step of an
   * eased tilt landing between the two. */
  turnBetweenRenderAndCommit() {
    turn([0, 1, 0]);
    flushSync(() => rerender!());
    turn([0, 2, 0]);
  },
  /** Where the group's centre stands now. */
  centre: () => globe.current!.position.toArray(),
  close() { root?.unmount(); root = undefined; host.replaceChildren(); },
  /** The words of each notice laid over the sheet. */
  notices: () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')].map(notice => notice.textContent),
};
