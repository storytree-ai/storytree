// Before/after pictures of ADR-0919 on the real desktop page: "before" bundles each changed file as it was at the
// increment's base commit (read from git), "after" the checkout's own. Same seed (the traversal capture's), session,
// viewport, turns and zooms. Run from the checkout root with `node --import tsx`; --retake writes into this folder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { bundle } from './build.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureOutput, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../..');
const OUT = captureOutput(HERE);
// Single frames go to the ignored dist/; only the side-by-side sheets are evidence.
const FRAMES = path.join(HERE, 'dist', 'frames');
mkdirSync(FRAMES, { recursive: true });

const EV = path.join(ROOT, 'packages/forest/src/view/evidence');
const seed = JSON.parse(readFileSync(path.join(EV, 'knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(EV, 'traversal/survey.json'), 'utf8'));
const KNOWLEDGE_CORE = 'story_4c04d95d52a8', FOREST = 'story_be32e99ed54f', AGENT_LINK = 'story_05e45963ca9f';
const LOOK_INSIDE_CAPABILITY = 'capability_83d80a307e18', CLAIMS_NOTE = 'decision_88f95657e45b', HOOKS_NOTE = 'decision_98e3f55d636d';
const session = 'builder', now = Date.now(), lines = [];
const line = (minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: new Date(now - minutes * 60_000).toISOString(), ...fields });
line(30, { kind: 'session-started' });
line(20, { kind: 'claimed', source: 'tool', capability: LOOK_INSIDE_CAPABILITY, reason: 'Build the traversal over the code' });
seed.lines = { lines, cursor: lines.length };
const file = (pkg, rest, resident = true) => ({ kind: 'file', id: `${ROOT}/packages/${pkg}/${rest}`, call: `f-${pkg}-${rest}`, tool: 'Read', resident });
const note = id => ({ kind: 'note', id, call: `open ${id}`, tool: 'mcp__storytree__open', resident: true });
const reading = { session, at: new Date(now).toISOString(), compactions: 1, inView: [], glimpses: [], opens: [
  file('knowledge-core', 'src/ghosts/ghosts.ts', false), note(LOOK_INSIDE_CAPABILITY), note('arc_f59eb2a8e34d'), note('increment_d02249eaf5a4'),
  file('knowledge-core', 'src/look-inside/look-inside.ts'), file('knowledge-core', 'src/view/surface.tsx'), file('knowledge-core', 'src/view/globe-points.tsx'),
  file('knowledge-core', 'src/reads/reads.ts'), note(CLAIMS_NOTE), note(HOOKS_NOTE), file('forest', 'src/view/planet-view.tsx'), file('forest', 'src/view/file-circles.ts'),
  { kind: 'file', id: `${ROOT}/scripts/gate.mjs`, call: 'f-gate', tool: 'Read', resident: true }, file('agent-link', 'src/context/window.ts'),
] };

const VIEWS = [
  { name: '1-opening', framing: null },
  { name: '2-agent-link-close', story: AGENT_LINK, framing: 0.5 },
  { name: '3-forest-hop', story: FOREST, framing: 0.85 },
  { name: '4-behind-the-core-island', story: KNOWLEDGE_CORE, framing: 0.9, back: true },
  { name: '5-behind-the-forest', story: FOREST, framing: 1.05, back: true },
  { name: '6-zoomed-past-the-islands', story: AGENT_LINK, framing: 0.1 },
  { name: '7-zoomed-back-out', story: AGENT_LINK, framing: 0.5 },
  { name: '8-library', story: KNOWLEDGE_CORE, framing: 1.0, library: true },
];
const report = {};

for (const which of ['before', 'after']) {
  const dist = await bundle(which);
  report[which] = {};
  await withCapture({ folder: HERE, dist }, async ({ browser, origin, settle }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await fakeBridge({}).install(page);
    await page.addInitScript(({ data, survey, reading }) => {
      const copy = v => structuredClone(v);
      let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
      window.storytreeAnswers = {
        projectSelection: async () => copy({ projects: data.projects, current }),
        chooseProject: async name => { current = name; return copy({ projects: data.projects, current }); },
        listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
        changesSince: async (_, c) => c === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, c) => c === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
        codeSurvey: async () => copy(survey),
        windowReadings(project, sessions) { return Promise.all(sessions.map(one => this.windowReading(project, one))); },
        windowReading: async () => copy(reading),
      };
    }, { data: seed, survey, reading });
    await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ids => {
      const s = window.__globe;
      if (document.body.dataset.state !== 'ready' || !s || !window.__nav) return false;
      return ids.every(id => !!s.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 60000 });
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
    await page.evaluate(() => { for (const m of document.querySelectorAll('[popover]')) if (m.matches(':popover-open')) m.hidePopover(); });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible()) await b.click(); }
    await settle(page);
    const row = page.getByRole('complementary', { name: 'Running sessions', exact: true }).locator(`.session-row[data-session-id="${session}"]`);
    await row.waitFor({ timeout: 30000 });
    await row.click();
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-trail:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
    await settle(page);
    // What is drawn: island grounds shown, depth layers, the glass's far face.
    const state = () => page.evaluate(`(() => {
      const { scene } = window.__globe;
      let grounds = 0, shownGrounds = 0, depth = 0, far = null;
      const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      scene.traverse(o => {
        if (o.name === 'island-ground') { grounds++; if (shown(o)) shownGrounds++; }
        if (o.name === 'island-depth') depth++;
        if (o.name === 'planet:shell') { const m = o.material.find(m => m.side === 1); far = { opaque: !m.transparent, depthWrite: m.depthWrite, shown: shown(o) }; }
      });
      return { grounds, shownGrounds, depth, far };
    })()`);
    for (const view of VIEWS) {
      if (view.library) { await page.locator('.forest-views button[data-forest-mode="library"]').click(); await settle(page); }
      await page.evaluate(`(() => {
        const { scene, camera, size, invalidate } = window.__globe, { rotation, onRotate } = window.__nav;
        const V = camera.position.constructor, Q = camera.quaternion.constructor;
        ${view.story ? `
        const at = scene.getObjectByName('planet:${view.story}').getWorldPosition(new V()).normalize();
        const eye = camera.position.clone().normalize().multiplyScalar(${view.back ? -1 : 1});
        onRotate(new Q().setFromUnitVectors(at, eye).multiply(rotation));` : ''}
        ${view.framing ? `
        let radius = 0; scene.traverse(o => { if (o.name === 'planet:shell') radius = o.geometry.parameters.radius; });
        camera.zoom = Math.min(size.width, size.height) / (2 * ${view.framing} * radius); camera.updateProjectionMatrix();` : ''}
        invalidate();
      })()`);
      // Headless frames take a few milliseconds; the page's own state settles in tens of them.
      await settle(page, 24);
      await page.waitForTimeout(400);
      await settle(page, 24);
      report[which][view.name] = await state();
      await page.screenshot({ path: path.join(FRAMES, `${view.name}--${which}.png`), timeout: 180000 });
    }
    report[which].errors = errors;
  });
}

// Before | after, one sheet per view.
await withCapture({ folder: HERE }, async ({ browser }) => {
  const sheet = await browser.newPage({ viewport: { width: 1440, height: 520 }, deviceScaleFactor: 1 });
  for (const view of VIEWS) {
    const cell = which => `<figure><img src="data:image/png;base64,${readFileSync(path.join(FRAMES, `${view.name}--${which}.png`)).toString('base64')}"><figcaption>${which}</figcaption></figure>`;
    await sheet.setContent(`<style>body{margin:0;background:#0b0e11;color:#e8edf0;font:600 18px system-ui}
      .g{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:6px}figure{margin:0;position:relative}
      img{width:100%;display:block}figcaption{position:absolute;left:10px;top:8px;background:#000a;padding:3px 10px;border-radius:4px}
      h1{font-size:18px;margin:8px 10px 0}</style><h1>${view.name}</h1><div class="g">${cell('before')}${cell('after')}</div>`);
    await sheet.screenshot({ path: path.join(OUT, `sheet-${view.name}.png`), fullPage: true });
  }
});
writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
