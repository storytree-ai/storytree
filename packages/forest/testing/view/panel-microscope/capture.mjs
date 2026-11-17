// The right-hand panel as a microscope (ADR-1350 D2, 4.55; Mick, 2026-11-16: "the right hand capabilities panel basically
// becomes like a looking glass a microscope that allows you to adjust the zoom level and drill into individual level
// capabilities"): The library's island alone, from a fresh seed and code survey built from the library and this checkout
// (the committed snapshot predates the survey's parts), as the app opens it. A capability's territory clicked on the island
// opens the panel; the story's name opens the story alone, its microscope showing its capabilities; the one whose code holds the most parts, chosen in the
// microscope, re-roots the panel on it, its parts filling the microscope with their gates named; 26 · Rounds, whose code is
// one part (librarian) holding parts of its own, opens two levels down, its breadcrumb back up. `node --import tsx
// capture.mjs <name>` (append --retake to write into src/view/evidence/panel-microscope). Measures, from the page, each
// level the microscope shows: its breadcrumb, its parts and its gates.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { seedHolding } from '../../../../../apps/desktop/src/capture/fresh-seed.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'panel-microscope');
const name = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'after';
const fresh = await seedHolding(['The library'], { committed: () => ({ seed: { tree: { stories: [] } }, survey: {} }) });
const library = fresh.seed.tree.stories.find(story => story.title === 'The library');
// The library's island alone (every island laid out from nothing takes the box tens of minutes): the other stories are kept
// by name, bare (no capabilities), so the gates to their islands are named as the app names them. Every story's survey
// keeps its roads (the other stories' files left out, which would lay their islands out), so the library's gates are those
// its own code reaches and those the other stories' code reaches it by, as in the app. Desktop app, the one story carrying
// extra checks, keeps its capabilities, so its panel shows them behind their closed handle (4.52).
const desktop = fresh.seed.tree.stories.find(story => story.title === 'Desktop app');
const others = fresh.seed.tree.stories.filter(story => story !== library).map(story => story === desktop ? story : { ...story, capabilities: [], edges: [] });
const seed = { ...fresh.seed, tree: { ...fresh.seed.tree, stories: [library, ...others] } };
const survey = Object.fromEntries(Object.entries(fresh.survey).map(([id, each]) => [id, id === library.id ? each : { files: [], edges: each.edges ?? [] }]));
const capability = prefix => library.capabilities.find(c => c.title.startsWith(prefix)).id;
// The capability whose code holds the most parts, so its microscope shows them with their gates.
const partsOf = id => (survey[library.id].parts?.capabilities[id] ?? []).length;
const widest = [...library.capabilities].sort((a, b) => partsOf(b.id) - partsOf(a.id))[0];
const dist = buildFolder(here);
await buildCapture({ dist });

const until = async (page, predicate, arg, timeout = 300_000) => page.waitForFunction(predicate, arg, { timeout, polling: 200 });
/** What the microscope shows now. */
const scope = page => page.evaluate(() => {
  const section = document.querySelector('aside.story-panel .panel-microscope');
  return section === null ? undefined : {
    root: section.dataset.scopeRoot,
    trail: [...section.querySelectorAll('.scope-trail > *:not(.scope-step)')].map(crumb => crumb.textContent),
    parts: [...section.querySelectorAll('[data-scope-child]')].map(child => child.querySelector('title')?.textContent),
    opens: [...section.querySelectorAll('[data-scope-child][role="button"]')].map(child => child.querySelector('title')?.textContent),
    gates: [...section.querySelectorAll('[data-scope-gate]')].map(gate => gate.dataset.scopeGate),
    names: [...section.querySelectorAll('[data-scope-name]')].map(name => name.textContent),
    overlapping: (() => {
      const boxes = [...section.querySelectorAll('[data-scope-name]')].map(name => name.getBoundingClientRect());
      return boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)).length;
    })(),
    pending: section.querySelector('[data-scope-pending]') !== null,
    // The story's extra checks, behind their handle (4.52): whether the handle is there, and closed.
    extraChecks: (() => {
      const handle = document.querySelector('aside.story-panel [data-fold="extra-checks"] > .panel-handle');
      return handle === null ? undefined : { handle: handle.textContent, open: handle.getAttribute('aria-expanded') === 'true' };
    })(),
  };
});
const laidOut = page => until(page, () => { const s = document.querySelector('aside.story-panel .panel-microscope'); return s !== null && s.querySelector('[data-scope-pending]') === null; });
const results = {};
const shot = async (page, out, view) => {
  await page.locator('aside.story-panel').screenshot({ path: path.join(out, `${view}-panel.png`) });
  return (results[view] = await scope(page));
};
const choose = id => async ({ page, settle }) => {
  // A territory in pieces has its box's middle on another's land, so the click is sent to the territory itself.
  await page.locator(`aside.story-panel .panel-microscope [data-pick-capability="${id}"]`).dispatchEvent('click');
  await settle(page, 6);
  await laidOut(page);
};

/** A click on the island's name selects the story alone; its panel's microscope shows the island's capabilities. */
const pickStory = (story, { laid = true } = {}) => async ({ page, settle }) => {
  // Another story's panel let go first, as the lag catalogue's reset does, so it cannot cover this island's name.
  if (await page.evaluate(() => document.body.dataset.selected !== undefined)) {
    await page.keyboard.press('Escape');
    await until(page, () => document.body.dataset.selected === undefined && document.querySelector('aside.story-panel')?.hidden !== false, undefined, 60_000);
  }
  if (!await page.evaluate(id => window.storytreeGlobe.face({ kind: 'story', story: id }), story.id)) throw new Error(`no camera stop for ${story.title}`);
  await until(page, () => window.storytreeGlobe.still());
  // The name is drawn over the canvas, which picks what lies under the pointer, the name among it (3.41).
  const box = await page.locator(`.planet-nameplate[data-story-id="${story.id}"]`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, 6);
  if (laid) await laidOut(page);
  else await until(page, id => document.querySelector(`aside.story-panel .panel-microscope[data-scope-story="${id}"]`) !== null, story.id);
};

await runCapture({
  folder: pictures, dist, seed, survey, name,
  prepare: async ({ page }) => {
    await until(page, () => document.body.dataset.state === 'ready');
    await until(page, () => document.querySelector('[data-layout="laying-out"]') === null, undefined, 1_200_000);
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), library.id, 1_200_000);
  },
  views: [{
    name: `${name}-story`,
    prepare: pickStory(library),
    measure: async ({ page, out }) => shot(page, out, 'story'),
    expect: found => {
      assert.equal(found.root, library.id, 'the story alone, rooted on the story');
      assert.equal(found.parts.length, library.capabilities.length, 'every capability on its land');
      assert.equal(found.overlapping, 0, 'no two names written over each other');
      assert.ok(found.gates.every(gate => !gate.startsWith('story_')), 'every other island named by its story');
    },
  }, {
    name: `${name}-capability`,
    prepare: choose(widest.id),
    measure: async ({ page, out }) => shot(page, out, 'capability'),
    expect: found => {
      assert.deepEqual(found.trail, ['The library', widest.title]);
      assert.ok(found.parts.length >= 2 && found.gates.length > 0, 'its parts fill the microscope, its gates named');
    },
  }, {
    name: `${name}-rounds-two-deep`,
    prepare: async ({ page, settle }) => {
      await page.locator('aside.story-panel .panel-microscope [data-pick-story]').click();
      await settle(page, 6);
      await laidOut(page);
      await choose(capability('26 '))({ page, settle });
    },
    measure: async ({ page, out }) => shot(page, out, 'rounds-two-deep'),
    expect: found => {
      assert.deepEqual(found.trail, ['The library', '26 · Rounds', 'librarian'], 'two levels down: the capability, then its one part, librarian');
      assert.ok(found.parts.length >= 2, 'librarian\'s own parts');
    },
  }, {
    name: `${name}-extra-checks`,
    // Its foot, not its microscope, is what this picture is for, so the panel is taken as soon as it is drawn.
    prepare: pickStory(desktop, { laid: false }),
    measure: async ({ page, out }) => {
      // The panel's foot, scrolled to, so the story's extra checks' closed handle is in the picture.
      await page.locator('aside.story-panel [data-fold="extra-checks"]').scrollIntoViewIfNeeded();
      return shot(page, out, 'extra-checks');
    },
    expect: found => {
      assert.equal(found.root, desktop.id, 'Desktop app alone, rooted on the story');
      assert.ok(found.extraChecks !== undefined && !found.extraChecks.open, 'its extra checks behind a closed handle');
    },
  }],
});
writeFileSync(path.join(captureOutput(pictures, { name }), `${name}-measurements.json`), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results, null, 1));
