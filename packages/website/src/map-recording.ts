/** Capability 2 · The forest on the site. The map chapter's four-story window onto the shop's saved record. */
import { growthPlan, type GrowthPlan, type GrowthOptions } from "@storytree/forest-world/planet";
import type { GrowthSnapshot } from "./forest-data.js";

/** Keep the first round's islands and capabilities, with their recorded health through the first CI run. */
export function mapRecording(saved: GrowthSnapshot): GrowthSnapshot {
  const first = saved.stages.find(stage => stage.id === "pr1")!;
  const built = saved.stages.find(stage => stage.id === "pr4")!;
  const checked = saved.stages.find(stage => stage.id === "pr7-building")!;
  const stories = new Set(built.scene.islands.map(island => island.story));
  const capabilities = new Set(built.scene.islands.flatMap(island => island.trees.flatMap(tree => tree.capability ? [tree.capability] : [])));
  const narrow = (scene: GrowthSnapshot["scene"]): GrowthSnapshot["scene"] => ({ ...scene,
    islands: scene.islands.filter(island => stories.has(island.story)).map(island => ({ ...island,
      trees: island.trees.filter(tree => !tree.capability || capabilities.has(tree.capability)),
      ...(island.land ? { land: { ...island.land, territories: island.land.territories.filter(part => !part.capability || capabilities.has(part.capability)),
        files: island.land.files.filter(file => !file.capability || capabilities.has(file.capability)) } } : {}),
    })),
    ...(scene.links ? { links: scene.links.filter(link => capabilities.has(link.from) && capabilities.has(link.to)) } : {}),
  });
  const stages = saved.stages.filter(stage => stage.at <= checked.at).map(stage => ({ ...stage, scene: narrow(stage.scene) }));
  // The export has code surveys at PR boundaries and capability landings between them. Reveal the first survey's
  // allocation in that recorded landing order; file sizes/ownership stay the survey's, never invented between commits.
  const landed = new Set<string>();
  for (const line of saved.reading?.recording.lines ?? []) {
    if (line.kind !== "landed" || !("capability" in line) || line.at >= first.at) continue;
    const capability = String(line.capability);
    if (!first.scene.islands.some(island => island.trees.some(tree => tree.capability === capability))) continue;
    landed.add(capability);
    const scene = narrow(first.scene);
    stages.push({ ...first, id: `land-${capability}`, at: line.at,
      wisps: saved.stages.find(stage => stage.id === "pr1-building")!.wisps,
      scene: { ...scene, islands: scene.islands.map(island => {
        const { land, ...planned } = island;
        if (!land) return island;
        const territories = land.territories.filter(part => part.capability && landed.has(part.capability));
        return territories.length ? { ...island, land: { ...land, territories,
          files: land.files.filter(file => file.capability && landed.has(file.capability)) } } : planned;
      }) },
    });
  }
  stages.sort((a, b) => a.at.localeCompare(b.at));
  return { ...saved, scene: narrow(checked.scene), stages };
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

/** The drawing uses this stage's land and statuses, rather than the final build's future territories. */
export function recordedScene(recording: GrowthSnapshot, plan: GrowthPlan, at: number): GrowthSnapshot["scene"] {
  const id = plan.stages.filter(stage => stage.start <= at).at(-1)?.id;
  const scene = recording.stages.find(stage => stage.id === id)?.scene;
  // Mount the planned islands for the camera even while the growth clock hides them beneath the empty globe.
  return scene?.islands.length ? scene : recording.stages.find(stage => stage.scene.islands.length)!.scene;
}
