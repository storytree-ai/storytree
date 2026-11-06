/** Capability 4 · The planet. A plumbing lane's label (ADR-1085 D3, ADR-1261 D5): its kind's words and nothing else, in
 * the DOM at the lane's middle, so the text stays text and reads to a screen reader. The files behind each kind are its hover title. */
import { createElement, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { usePlanetGrowth } from './PlanetGrowth.js';
import { Overlay } from './overlay.js';
import { litPlumbingLabels, type PlumbingLabel } from './plumbing.js';
import type { PlanetPathways } from './pathways.js';

/** Quiet by design: small, in the plumbing lane's own ink on the sea's dark, never a colour that shouts. */
const CHIP = {
  display: 'inline-block', padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap', pointerEvents: 'auto',
  font: '500 11px/16px system-ui, sans-serif', letterSpacing: '0.02em', color: '#cfdedb',
  background: 'rgba(16, 20, 24, 0.78)', border: '1px solid rgba(143, 169, 164, 0.55)',
} as const;

/** One chip per kind, stacked, each reading its kind only; the files making it are its title. Written with createElement,
 * not JSX, so a test renders it whichever JSX transform its runner is configured with. */
export function PlumbingChips({ chips }: { chips: PlumbingLabel['chips'] }) {
  return createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 } },
    chips.map(chip => createElement('span', { key: chip.kind, title: chip.files.join(', '), style: CHIP }, chip.kind)));
}

/** Under the islands' names (their overlays take 10 to 20): a chip that meets a name never covers it. A label shows once both its islands have risen, as its lane does (4.33). */
function LabelAt({ label }: { label: PlumbingLabel }) {
  const growth = usePlanetGrowth();
  const box = useRef<HTMLDivElement>(null);
  useFrame(() => {
    if (box.current) box.current.style.visibility = growth.island(label.from) >= 1 && growth.island(label.to) >= 1 ? 'visible' : 'hidden';
  });
  return <Overlay position={label.point!} center zIndexRange={[9, 1]} style={{ pointerEvents: 'none' }}>
    <div ref={box} data-plumbing={`${label.from}->${label.to}`}><PlumbingChips chips={label.chips} /></div>
  </Overlay>;
}

/** The label of each plumbing lane lit while `story` is selected (one of its two stories), at its lane's middle; none
 * with no story selected, nor while the exterior is hidden, as the islands' names are. */
export function PlumbingLabels({ plan, visible, story }: { plan: PlanetPathways; visible: boolean; story: string | undefined }) {
  const labels = useMemo(() => litPlumbingLabels(plan, story), [plan, story]);
  return <group name="pathways:plumbing-labels">{visible && labels.map(label => <LabelAt key={`${label.from}->${label.to}`} label={label} />)}</group>;
}
