// Capability 3 · Story node render
export interface PaintedScenes<Scene> {
  shown(scene: Scene): void;
  painted(scene: Scene): void;
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
