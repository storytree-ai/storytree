/** Capability 2 · The forest on the site. The map chapter's window onto the shop's saved record. */
import { growthPlan, type GrowthPlan, type GrowthOptions } from "@storytree/forest-world/planet";
import type { GrowthSnapshot } from "./forest-data.js";

/**
 * The map chapter's window onto the shop's saved record, to the Orders session's merge (pr9). Signing in, the story the first
 * session built, is alone on the map until the first round's three stories start being built together (pr3-building); the
 * second round's stories join when their sessions start writing (pr7-building), just after that survey's health is shown on
 * the first round alone.
 */
export function mapRecording(saved: GrowthSnapshot): GrowthSnapshot {
  const index = (id: string) => saved.stages.findIndex(stage => stage.id === id);
  const first = saved.stages[index("pr1")]!, building = saved.stages[index("pr1-building")]!, second = saved.stages[index("pr7-building")]!;
  const alone = new Set(building.wisps.map(wisp => wisp.story));
  const round = new Set(saved.stages[index("pr4")]!.scene.islands.map(island => island.story));
  const narrow = (scene: GrowthSnapshot["scene"], stories: ReadonlySet<string>): GrowthSnapshot["scene"] => {
    const islands = scene.islands.filter(island => stories.has(island.story));
    const capabilities = new Set(islands.flatMap(island => island.trees.flatMap(tree => tree.capability ? [tree.capability] : [])));
    return { ...scene, islands, ...(scene.links ? { links: scene.links.filter(link => capabilities.has(link.from) && capabilities.has(link.to)) } : {}) };
  };
  const stages = saved.stages.slice(0, index("pr9") + 1).flatMap((stage, at) => at < index("pr3-building") ? [{ ...stage, scene: narrow(stage.scene, alone) }]
    : at < index("pr7-building") ? [{ ...stage, scene: narrow(stage.scene, round) }]
    // The 03:08:57 survey's green on the first round, before its second-round islands rise.
    : at === index("pr7-building") ? [{ ...stage, id: "checked", scene: narrow(stage.scene, round), wisps: [] }, stage] : [stage]);
  // The export has code surveys at PR boundaries and capability landings between them. Reveal the first survey's
  // allocation in that recorded landing order; file sizes/ownership stay the survey's, never invented between commits.
  // Signing in's code reached the map only when its pull request merged, after its claims were released, so no claim
  // draws while it fills (ADR-0923).
  const landed = new Set<string>();
  const opening = narrow(first.scene, alone);
  for (const line of saved.reading?.recording.lines ?? []) {
    if (line.kind !== "landed" || !("capability" in line) || line.at >= first.at) continue;
    const capability = String(line.capability);
    if (!opening.islands.some(island => island.land?.territories.some(part => part.capability === capability))) continue;
    landed.add(capability);
    stages.push({ ...first, id: `land-${capability}`, at: line.at, wisps: [],
      scene: { ...opening, islands: opening.islands.map(island => {
        const { land, ...planned } = island;
        if (!land) return island;
        const territories = land.territories.filter(part => part.capability && landed.has(part.capability));
        return territories.length ? { ...island, land: { ...land, territories,
          files: land.files.filter(file => file.capability && landed.has(file.capability)) } } : planned;
      }) },
    });
  }
  stages.sort((a, b) => a.at.localeCompare(b.at));
  return { ...saved, scene: saved.stages[index("pr9")]!.scene, stages };
}

/** Every dated health/claim change gets a beat, even when it adds no new geometry. */
export function mapGrowthPlan(recording: GrowthSnapshot, roadLength?: GrowthOptions["roadLength"]): GrowthPlan {
  const plan = growthPlan(recording.stages.map(stage => ({ ...stage, hold: 1 })), { fromPoint: true, seconds: 15,
    ...(roadLength ? { roadLength } : {}), until: recording.stages.at(-1)!.at });
  for (const stage of plan.stages) {
    if (!stage.id.startsWith("land-")) continue;
    const capability = stage.id.slice(5), window = plan.capabilities.get(capability);
    if (window) plan.capabilities.set(capability, { ...window, start: stage.start });
  }
  return plan;
}

/** Land, health and claims come from one stage, so a newly surveyed territory never wears a previous holder's claim. */
export function recordedFrame(recording: GrowthSnapshot, plan: GrowthPlan, at: number): Pick<GrowthSnapshot["stages"][number], "scene" | "wisps"> {
  const id = plan.stages.filter(stage => stage.start <= at).at(-1)?.id;
  const stage = recording.stages.find(stage => stage.id === id);
  // Mount the planned islands for the camera even while the growth clock hides them beneath the empty globe.
  return { scene: stage?.scene.islands.length ? stage.scene : recording.stages.find(stage => stage.scene.islands.length)!.scene,
    wisps: stage?.wisps ?? [] };
}
