// Capability 4 · The planet

export const LIGHT_DIRECTION: { readonly x: number; readonly y: number; readonly z: number } =
  (() => {
    const [x, y, z] = [-0.45, 0.82, 0.35];
    const len = Math.hypot(x, y, z);
    return { x: x / len, y: y / len, z: z / len };
  })();
