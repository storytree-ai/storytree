import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useFrame, useThree } from "@react-three/fiber";
import { PlanetWorldCanvas } from "@storytree/forest-world/planet";
import saved from "./forest-snapshot.json" with { type: "json" };
import type { ForestSnapshot } from "./forest-data.js";

// JSON's inferred arrays lose tuple/literal types; the snapshot exporter tests its shape.
const snapshot = saved as unknown as ForestSnapshot;
const spots = new Map(snapshot.spots);

/** Report readiness after a rendered frame, and keep the still available after context loss. */
function FirstFrame({ ready, failed }: { ready(): void; failed(): void }) {
  const gl = useThree(state => state.gl);
  const reported = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  useFrame(() => {
    if (reported.current) return;
    reported.current = true;
    frame.current = requestAnimationFrame(ready);
  });
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", failed);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      canvas.removeEventListener("webglcontextlost", failed);
    };
  }, [gl, failed]);
  return null;
}

function Forest({ ready, failed }: { ready(): void; failed(): void }) {
  const [turn, setTurn] = useState(0);
  const rotation: [number, number, number, number] = [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)];
  return <>
    <div className="forest-drawing" role="img" aria-label="Storytree’s saved project map: story islands and their connections.">
      <PlanetWorldCanvas scene={snapshot.scene} spots={spots} radius={snapshot.radius} rotation={rotation}>
        <FirstFrame ready={ready} failed={failed} />
      </PlanetWorldCanvas>
    </div>
    <div className="forest-controls" aria-label="Turn the project map">
      <button type="button" onClick={() => setTurn(value => value - Math.PI / 6)} aria-label="Turn map left">←</button>
      <button type="button" onClick={() => setTurn(0)}>Reset view</button>
      <button type="button" onClick={() => setTurn(value => value + Math.PI / 6)} aria-label="Turn map right">→</button>
    </div>
  </>;
}

export function mountForest(host: HTMLElement, ready: () => void, failed: () => void): () => void {
  const root = createRoot(host, { onUncaughtError: failed });
  root.render(<Forest ready={ready} failed={failed} />);
  return () => root.unmount();
}
