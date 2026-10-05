// The authored light direction retained by the globe shell's highlight.
// `planet/planet.ts` rotates this into view space; the islands use unlit status colours.
// The flat canvas's shade ladder was retired with its renderer (ADR-0920).

export const LIGHT_DIRECTION: { readonly x: number; readonly y: number; readonly z: number } =
  (() => {
    const [x, y, z] = [-0.45, 0.82, 0.35];
    const len = Math.hypot(x, y, z);
    return { x: x / len, y: y / len, z: z / len };
  })();
