// Capability 4 · The planet
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { growthMoment, growthNow, growthProgress, type GrowthPlan } from './growth.js';

export interface PlanetGrowth { plan: GrowthPlan; at?: number | undefined }

export interface GrowthReader {
  now(): number;
  globe(): number;
  island(story: string): number;
  capability(capability: string): number;
  moment(date: string): number;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const WHOLE: GrowthReader = { now: () => Infinity, globe: () => 1, island: () => 1, capability: () => 1, moment: () => 0 };
const GrowthContext = createContext<GrowthReader>(WHOLE);

export function usePlanetGrowth(): GrowthReader { return useContext(GrowthContext); }

export function GrowthProvider({ growth, children }: { growth: PlanetGrowth | undefined; children: ReactNode }) {
  const { clock, invalidate } = useThree();
  const plan = growth?.plan;
  const started = useRef<{ plan: GrowthPlan | undefined; at: number; reduced: boolean }>({ plan: undefined, at: 0, reduced: false });
  if (started.current.plan !== plan) started.current = { plan, at: clock.getElapsedTime(), reduced: reducedMotion() };
  const at = growth?.at;
  const reader = useMemo((): GrowthReader => {
    if (plan === undefined) return WHOLE;
    const now = () => growthNow(at, clock.getElapsedTime() - started.current.at, started.current.reduced);
    const of = (window: Parameters<typeof growthProgress>[0]) => growthProgress(window, now(), false);
    return { now, globe: () => of(plan.globe), island: story => of(plan.islands.get(story)),
      capability: capability => of(plan.capabilities.get(capability)),
      moment: date => growthMoment(plan, date) };
  }, [plan, at, clock]);
  useFrame(() => { if (plan !== undefined && at === undefined && reader.now() < plan.seconds) invalidate(); });
  useEffect(() => invalidate(), [reader, invalidate]);
  return <GrowthContext.Provider value={reader}>{children}</GrowthContext.Provider>;
}
