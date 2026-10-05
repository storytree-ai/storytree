// Evidence only: actual desktop PlanetView with the site's committed drawing data.
import { createRoot } from 'react-dom/client';
import { PlanetView } from '../../../forest/src/view/planet-view.js';
import { createKnowledgeCore } from '../../../knowledge-core/src/view/index.js';
import snapshot from '../../src/forest-snapshot.json';

Object.assign(globalThis, { __snapshot: snapshot });
const core = createKnowledgeCore('website-evidence');
createRoot(document.getElementById('desktop-forest')!).render(
  <PlanetView core={core} scene={snapshot.scene} places={new Map()} wisps={[]} selected={undefined}
    onPick={() => {}} onNote={() => {}} library={false} framing={1.18} />,
);
