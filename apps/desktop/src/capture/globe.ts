/** Capability 2 · Storytree projects. Read-only globe observations, and zoom through the same wheel input as a person. */
import type { Page } from "playwright-core";

export interface GlobeTarget {
  id: string;
  /** CSS coordinates in the page, ready for page.mouse. */
  x: number;
  y: number;
}

export interface GlobeTargets {
  zoom: number;
  dots: GlobeTarget[];
  islands: GlobeTarget[];
}

/**
 * Targets nearer the eye than the globe's centre, inside the canvas and not hidden by an ancestor.
 * Bounds are fractions of the canvas's half-width/height; { x: .5, y: .6 } selects its middle.
 * This observes centres, not pixel occlusion by other marks or HTML panels.
 */
export async function visibleGlobeTargets(page: Page, bounds = { x: 1, y: 1 }): Promise<GlobeTargets> {
  if (![bounds.x, bounds.y].every(value => Number.isFinite(value) && value > 0 && value <= 1)) {
    throw new Error("Globe target bounds must be above 0 and at most 1");
  }
  // Text avoids tsx copying its function-name helpers into the page.
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
    const found = { zoom: camera.zoom, dots: [], islands: [] };
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

/**
 * Wheel toward an absolute camera zoom, returning the attained zoom (within 3%, one half-notch).
 * Save visibleGlobeTargets(...).zoom to return to an opening view, or multiply it for a close-up.
 * The pointer defaults to the canvas centre; callers can choose a returned target's coordinates.
 */
export async function zoomGlobe(page: Page, target: number, at?: { x: number; y: number }): Promise<number> {
  if (!Number.isFinite(target) || target <= 0) throw new Error("Globe zoom must be positive and finite");
  const state = await page.evaluate(`(() => {
    const state = globalThis.__globe;
    if (!state?.camera.isOrthographicCamera) throw new Error('Capture needs the orthographic globe before zooming');
    const box = state.gl.domElement.getBoundingClientRect();
    return { zoom: state.camera.zoom, min: state.controls.minZoom, max: state.controls.maxZoom,
      x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`) as { zoom: number; min: number; max: number; x: number; y: number };
  if (target < state.min || target > state.max) throw new Error(`Globe zoom ${target} is outside ${state.min}–${state.max}`);
  await page.mouse.move(at?.x ?? state.x, at?.y ?? state.y);
  let zoom = state.zoom;
  for (let step = 0; step < 128; step++) {
    if (Math.abs(zoom / target - 1) <= 0.03) return zoom;
    await page.mouse.wheel(0, zoom < target ? -240 : 240);
    try {
      await page.waitForFunction(`globalThis.__globe.camera.zoom !== ${zoom}`, undefined, { timeout: 2000 });
    } catch (cause) {
      throw new Error(`Globe wheel did not change zoom ${zoom} toward ${target}; check that the canvas receives the pointer`, { cause });
    }
    zoom = await page.evaluate(`globalThis.__globe.camera.zoom`);
  }
  throw new Error(`Globe wheel could not reach zoom ${target}; last zoom was ${zoom}`);
}
