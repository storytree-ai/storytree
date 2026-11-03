/**
 * Capability 3 · Story node render. Which scene the globe has painted, and the waits on it (3.75): `drawn` resolves once a frame
 * showing the scene last given to `shown` has been painted, so the page can settle a start only once the globe is on screen
 * (3.49, question_f1589345683f).
 */
export interface PaintedScenes<Scene> {
  /** The scene now on show. */
  shown(scene: Scene): void;
  /** A frame showing `scene` was painted. */
  painted(scene: Scene): void;
  /** Resolves once a frame of the scene on show has been painted. */
  drawn(): Promise<void>;
}

export function paintedScenes<Scene>(first: Scene): PaintedScenes<Scene> {
  let onShow = first;
  let painted: Scene | undefined;
  let waits: (() => void)[] = [];
  return {
    shown(scene) { onShow = scene; },
    painted(scene) {
      painted = scene;
      if (scene !== onShow) return;
      const done = waits;
      waits = [];
      for (const wait of done) wait();
    },
    drawn: () => painted === onShow ? Promise.resolve() : new Promise((resolve) => { waits.push(resolve); }),
  };
}
