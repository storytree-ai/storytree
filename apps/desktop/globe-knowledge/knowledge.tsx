/** Throwaway drawing only. Reuses the core's actual placements and the page's live core snapshot. */
import { useMemo, useSyncExternalStore } from 'react';
import { Line } from '@react-three/drei';
import { coreScene, knowledge, underShelves, ReadRecord, type Point } from '@storytree/knowledge-core';
import type { KnowledgeCore } from '@storytree/knowledge-core/view';
import type { Change } from '@storytree/library';

// The unmounted Look-inside surface reads this same internal store. This spike adapter is
// deliberately local, not a new public API or a production integration.
type SnapshotCore = KnowledgeCore & {
  get(): { history: readonly Change[] };
  subscribe(listener: () => void): () => void;
};
const noRaycast = () => {};
const tuple = ({ x, y, z }: Point): [number, number, number] => [x, y, z];

export function KnowledgePoints({ core, spots, radius, threads }: {
  core: KnowledgeCore; spots: ReadonlyMap<string, Point>; radius: number; threads: boolean;
}) {
  const store = core as SnapshotCore;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const { placed, scene } = useMemo(() => {
    const known = knowledge(state.history);
    const placed = underShelves(state.history, known);
    const scene = coreScene({ changes: state.history, knowledge: known, core: placed,
      spots, radius, reads: new ReadRecord('storytree'), session: undefined, sizeBy: 'links-in' });
    return { placed, scene };
  }, [state.history, spots, radius]);
  const entrances = new Map(scene.entrances.map(entrance => [entrance.node, entrance.at]));
  return <group name="knowledge-look" userData={{ placed: placed.placed.size, outside: placed.outside.length,
    depths: [...placed.placed.values()].map(({ note, depth, home }) => ({ note, depth, home })) }}>
    {scene.notes.filter(note => !note.ghost).map(note => {
      const placement = placed.placed.get(note.id);
      const shelf = placement === undefined ? undefined : entrances.get(placement.home);
      return <group key={note.id}>
        <mesh name={`knowledge-point:${note.id}`} position={tuple(note.at)} raycast={noRaycast}
          userData={{ id: note.id, title: note.title, depth: note.depth ?? null, home: placement?.home ?? null }}>
          <sphereGeometry args={[radius * 0.006, 12, 8]} />
          <meshBasicMaterial color="#a5c5d1" transparent opacity={0.52} depthWrite={false} />
        </mesh>
        {threads && shelf !== undefined && <Line name={`knowledge-thread:${note.id}`}
          points={[tuple(note.at), tuple(shelf)]} color="#a5c5d1" lineWidth={0.7}
          transparent opacity={0.18} depthWrite={false} raycast={noRaycast} />}
      </group>;
    })}
  </group>;
}
