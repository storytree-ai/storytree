/** The globe's growth clock (world 7.4): what the canvas and the host's marks read to draw a growth as it stands. */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { fileKey, growthMoment, growthProgress, type GrowthPlan } from './growth.js';

/** A growth to replay: its plan, and either a fixed moment (a host scrubbing it) or the canvas's own clock from when it was given. */
export interface PlanetGrowth { plan: GrowthPlan; at?: number | undefined }

/** How grown each thing is now: 1 for anything the growth does not schedule, and for everything once it is done. */
export interface GrowthReader {
  /** Seconds into the growth; Infinity when there is none. */
  now(): number;
  globe(): number;
  island(story: string): number;
  capability(capability: string): number;
  file(story: string, path: string): number;
  /** Where a recorded date falls in the growth, in its seconds (world 7.5); 0 when there is none. */
  moment(date: string): number;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const WHOLE: GrowthReader = { now: () => Infinity, globe: () => 1, island: () => 1, capability: () => 1, file: () => 1, moment: () => 0 };
const GrowthContext = createContext<GrowthReader>(WHOLE);

/** Read inside the globe (a plate's children, say) to fade a mark in with its island; read it in `useFrame`. */
export function usePlanetGrowth(): GrowthReader { return useContext(GrowthContext); }

/** Keeps the growth's clock and asks for frames while it is still growing; under reduced motion it is whole at once. */
export function GrowthProvider({ growth, children }: { growth: PlanetGrowth | undefined; children: ReactNode }) {
  const { clock, invalidate } = useThree();
  const plan = growth?.plan;
  const started = useRef<{ plan: GrowthPlan | undefined; at: number; reduced: boolean }>({ plan: undefined, at: 0, reduced: false });
  if (started.current.plan !== plan) started.current = { plan, at: clock.getElapsedTime(), reduced: reducedMotion() };
  const at = growth?.at;
  const reader = useMemo((): GrowthReader => {
    if (plan === undefined) return WHOLE;
    const now = () => started.current.reduced ? Infinity : at ?? clock.getElapsedTime() - started.current.at;
    const of = (window: Parameters<typeof growthProgress>[0]) => growthProgress(window, now(), started.current.reduced);
    return { now, globe: () => of(plan.globe), island: story => of(plan.islands.get(story)),
      capability: capability => of(plan.capabilities.get(capability)), file: (story, path) => of(plan.files.get(fileKey(story, path))),
      moment: date => growthMoment(plan, date) };
  }, [plan, at, clock]);
  useFrame(() => { if (plan !== undefined && at === undefined && reader.now() < plan.seconds) invalidate(); });
  // A fixed moment draws once when it changes.
  useEffect(() => invalidate(), [reader, invalidate]);
  return <GrowthContext.Provider value={reader}>{children}</GrowthContext.Provider>;
}
