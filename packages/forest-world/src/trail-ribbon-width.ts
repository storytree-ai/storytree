// Capability 3 · The canvas

export const RIBBON_GROUND_SCALE = 0.5;
export const RIBBON_MIN_SCREEN_PX = 1;

export function trailRibbonScreenWidth(width: number, zoom: number): number {
  if (!Number.isFinite(zoom) || !Number.isFinite(width)) return RIBBON_MIN_SCREEN_PX;
  return Math.max(RIBBON_MIN_SCREEN_PX, width * RIBBON_GROUND_SCALE * zoom);
}

export interface ZoomScaledRibbon {
  onBeforeRender(renderer: never, scene: never, camera: never, ...rest: never[]): void;
  readonly material: { linewidth: number };
}

export function scaleRibbonWithZoom(line: ZoomScaledRibbon, width: number): () => void {
  const own = Object.prototype.hasOwnProperty.call(line, 'onBeforeRender');
  const base = line.onBeforeRender;
  line.onBeforeRender = function (this: ZoomScaledRibbon, renderer: never, scene: never, camera: never, ...rest: never[]) {
    base.call(this, renderer, scene, camera, ...rest);
    const cam = camera as { readonly isOrthographicCamera?: boolean; readonly zoom?: number } | null;
    if (cam?.isOrthographicCamera === true && typeof cam.zoom === 'number') {
      line.material.linewidth = trailRibbonScreenWidth(width, cam.zoom);
    }
  };
  return () => {
    if (own) line.onBeforeRender = base;
    else delete (line as { onBeforeRender?: unknown }).onBeforeRender;
  };
}
