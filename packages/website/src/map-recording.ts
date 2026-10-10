/** Capability 2 · The forest on the site. The map chapter's window onto the shop's saved record. */
import { growthPlan, type GrowthPlan, type GrowthOptions } from "@storytree/forest-world/planet";
import type { GrowthSnapshot } from "./forest-data.js";

/**
 * The map chapter's window onto the shop's saved record, to the 03:08:57 survey that turns the first round green. Signing in,
 * the story the first session built, is alone on the map until the first round's three stories start being built together
 * (pr3-building); the second round's stories never rise (ADR-0891, amended 2026-10-10: five steps).
 */
export function mapRecording(saved: GrowthSnapshot): GrowthSnapshot {
  const index = (id: string) => saved.stages.findIndex(stage => stage.id === id);
  const first = saved.stages[index("pr1")]!, building = saved.stages[index("pr1-building")]!;
  const alone = new Set(building.wisps.map(wisp => wisp.story));
  const round = new Set(saved.stages[index("pr4")]!.scene.islands.map(island => island.story));
  const narrow = (scene: GrowthSnapshot["scene"], stories: ReadonlySet<string>): GrowthSnapshot["scene"] => {
    const islands = scene.islands.filter(island => stories.has(island.story));
    const capabilities = new Set(islands.flatMap(island => island.trees.flatMap(tree => tree.capability ? [tree.capability] : [])));
    return { ...scene, islands, ...(scene.links ? { links: scene.links.filter(link => capabilities.has(link.from) && capabilities.has(link.to)) } : {}) };
  };
  // The 03:08:57 survey's green on the first round ("checked"), then the moment the second round starts being built, which
  // the chapter runs until and never reaches: its islands and sessions are not shown.
  const stages = saved.stages.slice(0, index("pr7-building") + 1).flatMap((stage, at) => at === index("pr1-building") ? []
    : at < index("pr3-building") ? [{ ...stage, scene: narrow(stage.scene, alone) }]
    : at < index("pr7-building") ? [{ ...stage, scene: narrow(stage.scene, round) }]
    : [{ ...stage, id: "checked", scene: narrow(stage.scene, round), wisps: [] }, { ...stage, scene: narrow(stage.scene, round), wisps: [] }]);
  const lines = saved.reading?.recording.lines ?? [];
  const titles = new Map(saved.stages.flatMap(stage => stage.scene.islands.flatMap(island => island.land?.territories.flatMap(part => part.capability ? [[part.capability, part.title ?? part.capability] as const] : []) ?? [])));
  // While signing in has no code, its session stakes its capabilities as it claims them (ADR-0968 D4): the island carries an
  // equal share for each, and each claim is a flag in its share's lot, lifted when its capability lands. Browsing's claims
  // by the same session fall on an island not yet shown.
  const planned = narrow(building.scene, alone);
  const staked = { ...planned, islands: planned.islands.map(island => ({ ...island, land: { files: [], territories: island.trees.flatMap(tree => tree.capability
    ? [{ capability: tree.capability, title: titles.get(tree.capability) ?? tree.capability, status: tree.status ?? "untested", lines: 1 }] : []) } })) };
  const shares = new Set(staked.islands.flatMap(island => island.trees.flatMap(tree => tree.capability ? [tree.capability] : [])));
  const held = new Set<string>();
  for (const line of lines) {
    if ((line.kind !== "claimed" && line.kind !== "landed") || !("capability" in line) || line.at >= first.at || !shares.has(String(line.capability))) continue;
    const capability = String(line.capability);
    if (line.kind === "claimed") held.add(capability); else held.delete(capability);
    stages.push({ ...building, id: `${line.kind === "claimed" ? "staked" : "lifted"}-${capability}`, at: line.at, scene: staked,
      wisps: held.size ? building.wisps.filter(wisp => alone.has(wisp.story)).map(wisp => ({ ...wisp, capabilities: [...held] })) : [] });
  }
  // The export has code surveys at PR boundaries and capability landings between them. Signing in's code reached the map when
  // its pull request merged (pr1), after its claims were released: its territories take the lots' place there, one at a
  // time in the order the agent landed them, a millisecond apart; file sizes and ownership stay the survey's, never invented
  // between commits.
  const landed = new Set<string>();
  const opening = narrow(first.scene, alone);
  const landings = lines.filter(line => line.kind === "landed" && "capability" in line && line.at < first.at
    && opening.islands.some(island => island.land?.territories.some(part => part.capability === String((line as { capability: unknown }).capability))));
  landings.forEach((line, order) => {
    const capability = String((line as { capability: unknown }).capability);
    landed.add(capability);
    stages.push({ ...first, id: `land-${capability}`, at: new Date(Date.parse(first.at) - (landings.length - order)).toISOString(), wisps: [],
      scene: { ...opening, islands: opening.islands.map(island => {
        const { land, ...planned } = island;
        if (!land) return island;
        const territories = land.territories.filter(part => part.capability && landed.has(part.capability));
        return territories.length ? { ...island, land: { ...land, territories,
          files: land.files.filter(file => file.capability && landed.has(file.capability)) } } : planned;
      }) },
    });
  });
  stages.sort((a, b) => a.at.localeCompare(b.at));
  return { ...saved, scene: saved.stages[index("pr9")]!.scene, stages };
}

/**
 * Every dated health/claim change gets a beat, even when it adds no new geometry. Signing in's shares show from the first
 * claim on it, whole as the first flag drops, so each lot has its ground; its surveyed territories then replace them stage by stage.
 */
export function mapGrowthPlan(recording: GrowthSnapshot, roadLength?: GrowthOptions["roadLength"]): GrowthPlan {
  const plan = growthPlan(recording.stages.map(stage => ({ ...stage, hold: 1 })), { fromPoint: true, seconds: 15,
    ...(roadLength ? { roadLength } : {}), until: recording.stages.at(-1)!.at });
  const first = plan.stages.find(stage => stage.id.startsWith("staked-"));
  const staked = recording.stages.find(stage => stage.id === first?.id);
  for (const island of staked?.scene.islands ?? []) for (const part of island.land?.territories ?? []) {
    const window = part.capability ? plan.capabilities.get(part.capability) : undefined;
    if (window) plan.capabilities.set(part.capability!, { ...window, start: first!.start - window.seconds });
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
