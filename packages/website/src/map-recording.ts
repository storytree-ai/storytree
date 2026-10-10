/** Capability 2 · The forest on the site. The map chapter's window onto the shop's saved record. */
import { growthPlan, type GrowthPlan, type GrowthOptions } from "@storytree/forest-world/planet";
import type { GrowthSnapshot } from "./forest-data.js";

type Stage = GrowthSnapshot["stages"][number];
type Scene = Stage["scene"];
type Wisp = Stage["wisps"][number];

/** Beats the chapter's third step pins its lines to, all dated at the planned moment: the bare globe, then each island rising as
 * it is named, then the pathways to signing in and the pathways to browsing (ADR-0891, amended 2026-10-11: six steps). */
export const beats = ["plans", "planned", "risen-browsing", "risen-round", "pathways", "pathways-browsing"] as const;

/**
 * The map chapter's window onto the shop's saved record, to the 03:08:57 survey that turns the first round green, on the first
 * round's four stories only; the second round's never rise (ADR-0891, amended 2026-10-11). The planned moment is held as beats
 * (`beats`), each the whole planned plan, so the camera can find every island before it rises; mapGrowthPlan grows them one by
 * one. From the first landing on, an island with no code yet carries an equal share for each planned capability, and a
 * capability claimed on an island with code but no territory of its own carries a share while it is held, so every claim is
 * a flag in a share (ADR-0968 D4). Its sessions' flags are the recorded claims, each a stage of its own.
 */
export function mapRecording(saved: GrowthSnapshot): GrowthSnapshot {
  const index = (id: string) => saved.stages.findIndex(stage => stage.id === id);
  const planned = saved.stages[index("planned")]!, first = saved.stages[index("pr1")]!, end = saved.stages[index("pr7-building")]!;
  const round = new Set(saved.stages[index("pr4")]!.scene.islands.map(island => island.story));
  const narrow = (scene: Scene): Scene => {
    const islands = scene.islands.filter(island => round.has(island.story));
    const capabilities = new Set(islands.flatMap(island => island.trees.flatMap(tree => tree.capability ? [tree.capability] : [])));
    return { ...scene, islands, ...(scene.links ? { links: scene.links.filter(link => capabilities.has(link.from) && capabilities.has(link.to)) } : {}) };
  };
  const lines = saved.reading?.recording.lines ?? [];
  const titles = new Map(saved.stages.flatMap(stage => stage.scene.islands.flatMap(island => island.land?.territories.flatMap(part => part.capability ? [[part.capability, part.title ?? part.capability] as const] : []) ?? [])));
  const storyOf = new Map(narrow(planned.scene).islands.flatMap(island => island.trees.flatMap(tree => tree.capability ? [[tree.capability, island.story] as const] : [])));
  const colours = new Map(saved.stages.flatMap(stage => stage.wisps.map(wisp => [wisp.session, wisp.colour] as const)));
  const capabilityOf = (line: (typeof lines)[number]) => "capability" in line ? String(line.capability) : undefined;
  // The first round's claims and landings, to its last survey (pr4): the second round's sessions, which start claiming before
  // the 03:08:57 survey, are not shown.
  const roundEnd = saved.stages[index("pr4")]!.at;
  const claims = lines.filter(line => (line.kind === "claimed" || line.kind === "landed") && storyOf.has(capabilityOf(line) ?? "") && line.at <= roundEnd);
  /** Who holds what at `at`, from the recorded claims and landings: session by capability. */
  const heldAt = (at: string) => {
    const held = new Map<string, string>();
    for (const line of claims) if (line.at <= at) { if (line.kind === "claimed") held.set(capabilityOf(line)!, String(line.session)); else held.delete(capabilityOf(line)!); }
    return held;
  };
  /** One wisp for each session on each story it holds a capability on, in the session's recorded colour. */
  const wispsOf = (held: ReadonlyMap<string, string>): Wisp[] => {
    const by = new Map<string, Wisp>();
    for (const [capability, session] of held) {
      const story = storyOf.get(capability)!, key = `${session}\n${story}`;
      const wisp = by.get(key) ?? { session, story, colour: colours.get(session) ?? "hsl(0, 0%, 80%)", phase: 0, faded: false, capabilities: [] };
      by.set(key, { ...wisp, capabilities: [...wisp.capabilities, capability] });
    }
    return [...by.values()];
  };
  /** Shares for what has no code: every planned capability of an island with none, and each held capability with no territory. */
  const share = (island: Scene["islands"][number], held: ReadonlyMap<string, string>): Scene["islands"][number] => {
    const planned = island.trees.flatMap(tree => tree.capability ? [{ capability: tree.capability, status: tree.status ?? "untested" }] : []);
    if (!island.land) return { ...island, land: { files: [], territories: planned.map(({ capability, status }) => ({ capability, title: titles.get(capability) ?? capability, status, lines: 1 })) } };
    const surveyed = new Set(island.land.territories.map(part => part.capability));
    const lines = Math.round(island.land.territories.reduce((sum, part) => sum + part.lines, 0) / Math.max(1, island.land.territories.length));
    const extra = planned.filter(({ capability }) => held.has(capability) && !surveyed.has(capability))
      .map(({ capability }) => ({ capability, title: titles.get(capability) ?? capability, status: "untested" as const, lines }));
    return extra.length ? { ...island, land: { ...island.land, territories: [...island.land.territories, ...extra] } } : island;
  };
  const shared = (scene: Scene, held: ReadonlyMap<string, string>): Scene => ({ ...scene, islands: scene.islands.map(island => share(island, held)) });

  const stages: Stage[] = [{ ...saved.stages[index("empty")]!, wisps: [] }];
  // The planned moment, held as beats a millisecond apart: the plan whole in each, so the camera can find every island.
  const whole = narrow(planned.scene);
  beats.forEach((id, order) => stages.push({ ...planned, id, at: new Date(Date.parse(planned.at) + order - 1).toISOString(), scene: whole, wisps: [] }));
  // Signing in's and browsing's code reached the map when their pull request merged (pr1): their territories arrive one at a
  // time in the order the agent landed them, a millisecond apart; file sizes and ownership stay the survey's, never invented
  // between commits.
  const opening = narrow(first.scene);
  const landings = lines.filter(line => line.kind === "landed" && line.at < first.at
    && opening.islands.some(island => island.land?.territories.some(part => part.capability === capabilityOf(line))));
  const landed = new Set<string>();
  landings.forEach((line, order) => {
    landed.add(capabilityOf(line)!);
    const at = new Date(Date.parse(first.at) - (landings.length - order)).toISOString();
    // An island the survey found no code on carries its shares from the first landing on; one with code waits for its own.
    stages.push({ ...first, id: `land-${capabilityOf(line)}`, at, wisps: [], scene: { ...opening, islands: opening.islands.map(island => {
      const { land, ...plain } = island;
      if (!land) return share(island, new Map());
      const territories = land.territories.filter(part => part.capability && landed.has(part.capability));
      return territories.length ? { ...island, land: { ...land, territories, files: land.files.filter(file => file.capability && landed.has(file.capability)) } } : plain;
    }) } });
  });
  // From the merge to the second round: the surveys and every claim and landing between them, each claim a flag in its share.
  const surveys = saved.stages.slice(index("pr1"), index("pr7-building")).filter(stage => stage.id !== "pr1-building");
  const sceneAt = (at: string) => surveys.filter(stage => stage.at <= at).at(-1)!.scene;
  for (const stage of surveys) { const held = heldAt(stage.at); stages.push({ ...stage, scene: shared(narrow(stage.scene), held), wisps: wispsOf(held) }); }
  for (const line of claims) {
    if (line.at <= first.at || line.at >= end.at) continue;
    const held = heldAt(line.at);
    stages.push({ ...first, id: `${line.kind === "claimed" ? "staked" : "lifted"}-${capabilityOf(line)}`, at: line.at, scene: shared(narrow(sceneAt(line.at)), held), wisps: wispsOf(held) });
  }
  // A beat once the first round's claims all stand (02:28:30), so the claims step's first line has them all down before its
  // panels open.
  const together = new Date(Date.parse(claims.filter(line => line.kind === "claimed" && line.at > first.at).at(-1)!.at) + 3000).toISOString();
  stages.push({ ...first, id: "together", at: together, scene: shared(narrow(sceneAt(together)), heldAt(together)), wisps: wispsOf(heldAt(together)) });
  // The 03:08:57 survey's green on the first round ("checked"), then the moment the second round starts being built, which
  // the chapter runs until and never reaches: its islands and sessions are not shown.
  stages.push({ ...end, id: "checked", scene: narrow(end.scene), wisps: [] }, { ...end, scene: narrow(end.scene), wisps: [] });
  stages.sort((a, b) => a.at.localeCompare(b.at));
  return { ...saved, scene: saved.stages[index("pr9")]!.scene, stages };
}

/** How long the replay holds each of the third step's beats, at its natural pace, so each island rises about as it is named. */
const holds: Record<string, number> = { plans: 8.5, planned: 2, "risen-browsing": 2 };
/** The plan the third step's beats grow from: the islands named so far, and the pathways said so far. */
function grown(id: string, scene: Scene, rising: readonly string[]): Scene {
  const at = beats.indexOf(id as (typeof beats)[number]);
  if (at < 0 || at === beats.length - 1) return scene;
  const [signingIn, browsing] = rising;
  const shown = new Set(at <= 0 ? [] : at === 1 ? [signingIn] : at === 2 ? [signingIn, browsing] : scene.islands.map(island => island.story));
  const islands = scene.islands.filter(island => shown.has(island.story));
  const to = new Set(scene.islands.find(island => island.story === signingIn)?.trees.flatMap(tree => tree.capability ? [tree.capability] : []));
  return { ...scene, islands, links: id === "pathways" ? (scene.links ?? []).filter(link => to.has(link.to)) : [] };
}

/**
 * Every dated health/claim change gets a beat, even when it adds no new geometry. The third step's beats grow the islands one
 * by one as they are named (signing in, browsing, then the cart and checkout), then the pathways to signing in, then those to
 * browsing; each frame still draws the whole planned plan, the growth clock keeping what is not yet named beneath the globe.
 */
export function mapGrowthPlan(recording: GrowthSnapshot, roadLength?: GrowthOptions["roadLength"]): GrowthPlan {
  // The order the agents started on the stories: by each island's first recorded claim.
  const planned = recording.stages.find(stage => stage.id === "planned")!.scene.islands;
  const firstClaim = (island: (typeof planned)[number]) => (recording.reading?.recording.lines ?? [])
    .find(line => line.kind === "claimed" && "capability" in line && island.trees.some(tree => tree.capability === String(line.capability)))?.at ?? "~";
  const rising = [...planned].sort((a, b) => firstClaim(a).localeCompare(firstClaim(b))).map(island => island.story);
  return growthPlan(recording.stages.map(stage => ({ ...stage, scene: grown(stage.id, stage.scene, rising), hold: holds[stage.id] ?? 1 })), { fromPoint: true, seconds: 15,
    ...(roadLength ? { roadLength } : {}), until: recording.stages.at(-1)!.at });
}

/** Land, health and claims come from one stage, so a newly surveyed territory never wears a previous holder's claim. */
export function recordedFrame(recording: GrowthSnapshot, plan: GrowthPlan, at: number): Pick<Stage, "scene" | "wisps"> {
  const id = plan.stages.filter(stage => stage.start <= at).at(-1)?.id;
  const stage = recording.stages.find(stage => stage.id === id);
  // Mount the planned islands for the camera even while the growth clock hides them beneath the empty globe.
  return { scene: stage?.scene.islands.length ? stage.scene : recording.stages.find(stage => stage.scene.islands.length)!.scene,
    wisps: stage?.wisps ?? [] };
}
