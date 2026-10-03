// Forest 3.3, 3.4, 3.9, 3.10, 3.13, 7.4 and 4.11: the mounted public views in real Chromium, measured.
// Run from the checkout: node --import tsx packages/forest/evidence/mounted-views/capture.mjs [--mutate=mode|emphasis|fit]
// Each proof runs in its own page so its precise V8 coverage holds only what that proof executed.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { withCapture, settle } from '../../../../apps/desktop/src/capture/index.ts';
import { recordBrowserCoverage } from '../../../dev-loop/src/browser-coverage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '../..');
const out = path.join(here, 'out');
const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.slice('--mutate='.length);
// Each mutation changes only this capture's bundle, removing one real behaviour a proof below checks.
const MUTATIONS = {
  mode: [/forest-view\.tsx$/, '    render({ mode });\n', '    render({});\n'],
  emphasis: [/session-emphasis\.tsx$/, 'emphasis === "held" ? 1.16 : 0.24', '1'],
  fit: [/tree-space\.ts$/, '() => moving.fit()', '() => {}'],
};
assert.ok(mutation === undefined || MUTATIONS[mutation], `--mutate is one of ${Object.keys(MUTATIONS).join(', ')}`);
const codeRows = path.join(pkgDir, 'src/view/evidence/code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(codeRows, 'seed.json.gz'))));
const survey = JSON.parse(readFileSync(path.join(codeRows, 'survey.json')));
const PROOFS = {
  globe: 'forest 3.3 a click on a facing story node selects it through the public view; 3.4 nameplates; 3.9, 3.10 Library and Forest keep one canvas; 3.13 the card slot',
  sessions: "forest 7.4 the mounted view lights a hovered session's held island, dims the others, and restores them on leaving",
  tree: "forest 4.11 the capability tree's own space opens fitted, fits again after a drag, chooses a clicked card, and closes",
};

mkdirSync(out, { recursive: true });
const results = {};
const traces = {};
try {
  await build({
    entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'), bundle: true, sourcemap: 'external',
    format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2023', loader: { '.glb': 'binary' }, logLevel: 'warning',
    define: { __SEED__: JSON.stringify(seed), __SURVEY__: JSON.stringify(survey), 'process.env.NODE_ENV': '"production"' },
    plugins: mutation === undefined ? [] : [{ name: `red-${mutation}`, setup(builder) {
      const [filter, from, to] = MUTATIONS[mutation];
      builder.onLoad({ filter }, ({ path: sourcePath }) => {
        const source = readFileSync(sourcePath, 'utf8');
        const changed = source.replace(from, to);
        assert.notEqual(changed, source, `the ${mutation} mutation must change the real source`);
        return { contents: changed, loader: sourcePath.endsWith('x') ? 'tsx' : 'ts' };
      });
    } }],
  });
  writeFileSync(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css">
<style>html,body{margin:0;width:100%;height:100%;background:#101418;color:#e7edf0;font:14px system-ui}#content{position:absolute;inset:0}#globe{position:absolute;inset:0}#panel{position:absolute;right:0;top:0;width:360px}</style>
</head><body><div id="content" class="forest-workspace" data-theme="dark"><div id="globe"></div><aside id="panel"></aside></div><script src="/bundle.js"></script></body></html>`);

  await withCapture({ folder: here, dist: out }, async ({ browser, origin }) => {
    const proof = async (key, run) => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await page.goto(origin);
      results[key] = await run(page);
      assert.deepEqual(errors, [], `${key}: no page errors`);
      const scripts = (await page.coverage.stopJSCoverage()).filter(script => script.url.endsWith('/bundle.js')).map(script => ({
        functions: script.functions, source: script.source,
        sourceMap: JSON.parse(readFileSync(path.join(out, 'bundle.js.map'), 'utf8')),
        bundlePath: 'evidence/mounted-views/out/bundle.js',
      }));
      assert.equal(scripts.length, 1, 'one generated bundle and its matching map');
      traces[key] = scripts;
      await page.close();
    };
    const opened = async page => {
      await page.evaluate(() => window.proof.open());
      await page.waitForFunction(() => window.proof.ready(), null, { timeout: 60_000 });
      await settle(page, 8);
    };
    const shot = async (page, name) => { if (mutation === undefined) await page.screenshot({ path: path.join(here, `${name}.png`) }); };

    await proof('globe', async page => {
      const exported = await page.evaluate(() => window.proof.exported);
      for (const name of ['openForestView', 'mountLibraryPanel', 'renderStoryPanel', 'renderTree', 'attachPanZoom', 'mountTreeSpace', 'mountSessionsList', 'PlanetView']) {
        assert.equal(exported[name], 'function', `the public view exports ${name}`);
      }
      await opened(page);
      const host = page.locator('#globe');
      assert.equal(await host.getAttribute('data-view'), 'globe');
      assert.equal(await host.getAttribute('data-forest-mode'), 'forest', '3.10 a new launch opens in Forest');
      const canvas = await page.evaluateHandle(() => window.proof.canvas());
      // 3.4: each near-side story node carries its story's name.
      const plates = await page.$$eval('.planet-nameplate:not(.capability)', nodes => nodes.map(node => ({
        story: node.dataset.storyId, title: node.textContent, facing: Number(node.dataset.facing), box: node.getBoundingClientRect().toJSON(),
        visible: getComputedStyle(node).visibility !== 'hidden' })));
      const stories = await page.evaluate(() => window.proof.stories);
      assert.equal(plates.length, stories.length, '3.4 one nameplate per story node');
      const facingPlates = plates.filter(plate => plate.visible && plate.facing > 0.5);
      assert.ok(facingPlates.length > 0 && facingPlates.every(plate => plate.title.length > 0), '3.4 facing story nodes show their names');
      // 3.3: a click just above a facing nameplate lands on its island and selects that story.
      const target = facingPlates.sort((a, b) => b.facing - a.facing)[0];
      await page.mouse.click(target.box.x + target.box.width / 2, target.box.y - 24);
      await page.waitForFunction(() => window.proof.selections().length > 0);
      const picked = (await page.evaluate(() => window.proof.selections())).at(-1);
      assert.equal(picked?.kind, 'story', '3.3 clicking a story node selects a story');
      assert.equal(picked.id, target.story, '3.3 the story clicked is the one selected');
      await page.waitForSelector(`.planet-nameplate.selected[data-story-id="${target.story}"]`);
      await settle(page, 8);
      const capabilityPlates = await page.locator('.planet-nameplate.capability').count();
      assert.ok(capabilityPlates > 0, 'the selected story names its capabilities on their territories');
      await shot(page, 'globe-selected');
      // 3.9, 3.10: Library hides the story nodes and clears the selection; Forest brings them back on the same canvas.
      await page.click('button[data-forest-mode="library"]');
      await page.waitForFunction(() => document.querySelector('#globe').dataset.forestMode === 'library');
      await page.waitForFunction(() => document.querySelectorAll('.planet-nameplate').length === 0);
      assert.equal(await page.getAttribute('button[data-forest-mode="library"]', 'aria-pressed'), 'true');
      assert.equal((await page.evaluate(() => window.proof.selections())).at(-1), null, '3.10 choosing Library clears the story selection');
      assert.ok(await page.evaluate(c => window.proof.canvas() === c, canvas), '3.10 Library keeps the canvas');
      await settle(page, 8);
      await shot(page, 'globe-library');
      await page.click('button[data-forest-mode="forest"]');
      await page.waitForFunction(() => document.querySelector('#globe').dataset.forestMode === 'forest');
      await page.waitForFunction(n => document.querySelectorAll('.planet-nameplate').length === n, stories.length);
      assert.ok(await page.evaluate(c => window.proof.canvas() === c, canvas), '3.10 Forest keeps the canvas');
      // Escape closes a story selected through the view's handle.
      await page.evaluate(story => window.proof.select(story), target.story);
      await page.waitForSelector(`.planet-nameplate.selected[data-story-id="${target.story}"]`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.proof.selections().at(-1) === null);
      // 3.13: the card slot mounts the knowledge core's card and lets it go.
      await page.evaluate(() => { window.card = window.proof.libraryCard(); });
      assert.equal(await page.evaluate(() => window.card.unmount()), 0, 'unmounting the card is not a close');
      await page.evaluate(() => window.proof.dispose());
      assert.equal(await page.locator('#globe canvas').count(), 0, 'disposing removes the canvas');
      assert.equal(await page.evaluate(() => document.querySelector('#globe').childElementCount), 0, 'and empties its host');
      return { stories: stories.length, facing: facingPlates.length, picked: target.story, capabilityPlates };
    });

    await proof('sessions', async page => {
      await opened(page);
      const story = await page.evaluate(() => window.proof.story);
      assert.deepEqual(await page.evaluate(() => window.proof.brightness()), {}, 'nothing is lit or dimmed before a row is hovered');
      await page.evaluate(story => window.proof.highlight([story], 'proof-fixture'), story);
      await page.waitForFunction(story => {
        const lit = window.proof.brightness();
        return lit[story]?.length > 0 && Object.keys(lit).some(other => other !== story);
      }, story, { timeout: 30_000 });
      await settle(page, 8);
      const lit = await page.evaluate(() => window.proof.brightness());
      assert.ok(lit[story].every(value => value > 1), `7.4 the held island is lit: ${lit[story]}`);
      const others = Object.entries(lit).filter(([other]) => other !== story);
      assert.ok(others.every(([, values]) => values.every(value => value < 1)), '7.4 every other island is dimmed');
      assert.ok((await page.evaluate(() => window.proof.marks('session-highlight:'))).includes(`session-highlight:${story}`), '7.4 the held island is ringed');
      await shot(page, 'session-highlight');
      await page.evaluate(() => window.proof.highlight(undefined));
      await page.waitForFunction(() => Object.keys(window.proof.brightness()).length === 0);
      assert.deepEqual(await page.evaluate(() => window.proof.marks('session-highlight:')), [], '7.4 leaving the row restores the ordinary forest');
      await page.evaluate(() => window.proof.dispose());
      return { story, lit: lit[story].length, dimmedIslands: others.length };
    });

    await proof('tree', async page => {
      const story = seed.tree.stories.find(row => row.title === 'The forest').id;
      await page.evaluate(story => { window.tree = window.proof.tree(story); }, story);
      const space = page.locator('section.tree-space');
      await space.waitFor();
      const fitted = async () => page.evaluate(() => {
        const frame = document.querySelector('.tree-space-frame').getBoundingClientRect();
        const box = document.querySelector('.tree-space-diagram').getBoundingClientRect();
        return { transform: document.querySelector('.tree-space-surface').style.transform,
          inside: box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1 };
      });
      const opening = await fitted();
      assert.ok(opening.inside, '4.11 the space opens with the whole tree in its frame');
      const capabilities = await page.evaluate(() => window.tree.capabilities);
      assert.equal(await space.locator('[data-capability-id]').count(), capabilities.length, 'each of the story\'s capabilities is a card');
      assert.match(await space.locator('h2').textContent(), /capability tree$/);
      await shot(page, 'tree-space');
      const frame = await space.locator('.tree-space-frame').boundingBox();
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await page.mouse.down();
      await page.mouse.move(frame.x + frame.width / 2 + 260, frame.y + frame.height / 2 + 140, { steps: 6 });
      await page.mouse.up();
      assert.notEqual((await fitted()).transform, opening.transform, 'a drag moves the tree');
      await space.locator('.tree-space-fit').click();
      assert.deepEqual(await fitted(), opening, '4.11 Fit returns to the whole tree');
      await space.locator('[data-capability-id]').first().click();
      assert.deepEqual(await page.evaluate(() => window.tree.chosen()), [capabilities[0]], 'a clicked card is chosen');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => [window.tree.open(), window.tree.closed()].join()), 'false,1', 'Escape closes the space');
      await page.evaluate(id => window.tree.redraw(id), capabilities[0]);
      assert.equal(await page.evaluate(() => window.tree.open()), true);
      await space.locator('.tree-space-close').click();
      assert.equal(await page.evaluate(() => window.tree.closed()), 2, 'its close button closes it');
      await page.evaluate(() => window.tree.stop());
      assert.equal(await page.locator('section.tree-space').count(), 0, 'stopping removes the space');
      return { story, cards: capabilities.length, opening: opening.transform };
    });
  });

  assert.equal(mutation, undefined, 'a mutated capture can never publish allocation evidence');
  const measured = Object.fromEntries(Object.entries(PROOFS).map(([key, proof]) => [key, recordBrowserCoverage({ pkgDir, proof, passed: true, scripts: traces[key] })]));
  // The three proofs share one bundle and map: keep them once, with each proof's own functions.
  const { source, sourceMap, bundlePath } = traces.globe[0];
  writeFileSync(path.join(here, 'browser-trace.json.gz'), gzipSync(JSON.stringify({ bundlePath, source, sourceMap,
    proofs: Object.fromEntries(Object.entries(PROOFS).map(([key, proof]) => [key, { proof, functions: traces[key][0].functions }])) })));
  const record = { capturedAt: new Date().toISOString(), proofs: PROOFS, results, measured };
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ results, measured }, null, 2));
} catch (error) {
  // A failed normal capture withdraws these proofs' previous inputs: a failure proves nothing.
  if (mutation === undefined) for (const proof of Object.values(PROOFS)) { try { recordBrowserCoverage({ pkgDir, proof, passed: false, scripts: [] }); } catch {} }
  throw error;
} finally {
  rmSync(out, { recursive: true, force: true });
}
