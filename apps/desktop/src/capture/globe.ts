// Capability 2 · Storytree projects
import type { Page } from "playwright-core";

export interface GlobeTarget {
  id: string;
  x: number;
  y: number;
}

export interface GlobeTargets {
  zoom: number;
  dots: GlobeTarget[];
  islands: GlobeTarget[];
}

const EYE_ZOOM = `(state => {
  const { camera, controls, size } = state;
  if (!camera?.isPerspectiveCamera || !controls?.target || !size) throw new Error('Capture needs the map\\'s perspective eye, its controls and its size; wait for the globe');
  const focal = Math.max(size.height, 1) / 2 / Math.tan(camera.fov * Math.PI / 360);
  const eye = camera.position, middle = controls.target;
  return focal / (Math.hypot(eye.x, eye.y, eye.z) - Math.hypot(middle.x, middle.y, middle.z));
})`;

export async function visibleGlobeTargets(page: Page, bounds = { x: 1, y: 1 }): Promise<GlobeTargets> {
  if (![bounds.x, bounds.y].every(value => Number.isFinite(value) && value > 0 && value <= 1)) {
    throw new Error("Globe target bounds must be above 0 and at most 1");
  }
  return page.evaluate(`(bounds => {
    const state = globalThis.__globe;
    if (!state) throw new Error('Capture globe observation is unavailable; use buildCapture and wait for the globe');
    const { scene, camera, gl } = state;
    const globe = scene.getObjectByName('globe');
    if (!globe) throw new Error('Capture globe is not ready');
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const centre = globe.getWorldPosition(globe.position.clone());
    const eye = camera.getWorldPosition(camera.position.clone());
    const centreDistance = centre.distanceTo(eye);
    const box = gl.domElement.getBoundingClientRect();
    const found = { zoom: ${EYE_ZOOM}(state), dots: [], islands: [] };
    scene.traverseVisible(object => {
      const kind = object.name.startsWith('knowledge-point:') ? 'dots' : object.name.startsWith('planet:') ? 'islands' : undefined;
      if (!kind) return;
      const at = object.getWorldPosition(object.position.clone());
      if (at.distanceTo(eye) >= centreDistance) return;
      const ndc = at.project(camera);
      if (Math.abs(ndc.x) >= bounds.x || Math.abs(ndc.y) >= bounds.y || Math.abs(ndc.z) > 1) return;
      const id = kind === 'dots' ? object.userData.id : object.name.slice('planet:'.length);
      found[kind].push({ id, x: box.left + (ndc.x + 1) * box.width / 2, y: box.top + (1 - ndc.y) * box.height / 2 });
    });
    for (const targets of [found.dots, found.islands]) targets.sort((a, b) => a.id.localeCompare(b.id));
    return found;
  })(${JSON.stringify(bounds)})`);
}

export async function zoomGlobe(page: Page, target: number, at?: { x: number; y: number }): Promise<number> {
  if (!Number.isFinite(target) || target <= 0) throw new Error("Globe zoom must be positive and finite");
  const state = await page.evaluate(`(() => {
    const state = globalThis.__globe;
    if (!state) throw new Error('Capture globe observation is unavailable; use buildCapture and wait for the globe');
    const zoom = ${EYE_ZOOM}(state), { camera, controls, size, gl } = state;
    const focal = Math.max(size.height, 1) / 2 / Math.tan(camera.fov * Math.PI / 360);
    const box = gl.domElement.getBoundingClientRect();
    return { zoom, min: focal / (controls.maxDistance ?? Infinity), max: focal / (controls.minDistance ?? 0),
      x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`) as { zoom: number; min: number; max: number; x: number; y: number };
  if (target < state.min || target > state.max) throw new Error(`Globe zoom ${target} is outside ${state.min}–${state.max}`);
  await page.mouse.move(at?.x ?? state.x, at?.y ?? state.y);
  let zoom = state.zoom;
  for (let step = 0; step < 128; step++) {
    if (Math.abs(zoom / target - 1) <= 0.03) return zoom;
    await page.mouse.wheel(0, zoom < target ? -240 : 240);
    try {
      await page.waitForFunction(`${EYE_ZOOM}(globalThis.__globe) !== ${zoom}`, undefined, { timeout: 2000 });
    } catch (cause) {
      throw new Error(`Globe wheel did not change zoom ${zoom} toward ${target}; check that the canvas receives the pointer`, { cause });
    }
    zoom = await page.evaluate(`${EYE_ZOOM}(globalThis.__globe)`);
  }
  throw new Error(`Globe wheel could not reach zoom ${target}; last zoom was ${zoom}`);
}
