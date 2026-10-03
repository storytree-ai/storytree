// Node-only: Conduit's saved growth (ADR-0879 D7). The tour introduces storytree's ideas on Conduit's own
// library as it grew, one recorded stage at a time; every stage is replayed from its history, never drawn by hand.
import type { Line } from "@storytree/agent-link";
import { workStates } from "@storytree/arc-surface";
import { forestScene, growPlanet, sessionColour, storyNodes, type SessionWisp } from "@storytree/forest";
import type { ProjectSurvey } from "@storytree/forest/code-survey";
import { saveForestSnapshot } from "@storytree/forest/snapshot";
import { islandCoastReach } from "@storytree/forest-world/geometry";
import type { AnnotatedCapability, AnnotatedStory, AnnotatedTree, Change, HealthState } from "@storytree/library";
import type { GrowthSnapshot } from "./forest-data.js";
import { scrub } from "./tour-snapshot.js";

export interface GrowthReading {
  project: string;
  capturedAt: string;
  window: { from: string; to: string };
  /** The plan as it stands now: it fixes every island's place, so islands keep their spots as the globe grows. */
  tree: AnnotatedTree;
  changes: readonly Change[];
  lines: readonly Line[];
  /** The moments the tour grows through, each named and dated. */
  stages: readonly { id: string; at: string }[];
  /** The code's survey as it stood at `at`, for `plan`'s stories; without it, no stage draws land. */
  surveyAt?(at: string, plan: AnnotatedTree): Promise<ProjectSurvey>;
}

type Fields = Record<string, unknown>;
const time = (value: string) => Date.parse(value);
/** Failing if any is failing, passing only if there is one and all pass, not checked otherwise (the library's roll-up). */
const rollUp = (states: readonly HealthState[]): HealthState =>
  states.includes("failing") ? "failing" : states.length > 0 && states.every(state => state === "passing") ? "passing" : "not-checked";

/** Every record as its latest version written by `at`; a record retired by then is gone. */
function recordsAt(changes: readonly Change[], at: string) {
  const live = new Map<string, { type: string; fields: Fields }>();
  for (const change of [...changes].sort((a, b) => a.seq - b.seq)) {
    if (time(change.record.updatedAt) > time(at)) continue;
    if (change.action === "retired") live.delete(change.recordId);
    else live.set(change.recordId, { type: change.type, fields: change.record.fields as Fields });
  }
  return live;
}

/**
 * The plan as it stood at `at`, replayed from `changes`: only the stories, capabilities and contracts recorded by
 * then, each as last written, with each contract's health as last reported by then and the rest rolled up from it.
 * `tree` (the plan now) gives the stories' order; nothing is taken from it that the history does not also say.
 */
export function planAt(tree: AnnotatedTree, changes: readonly Change[], at: string): AnnotatedTree {
  const live = recordsAt(changes, at);
  const of = (type: string) => [...live].filter(([, record]) => record.type === type);
  const order = [...tree.stories.map(story => story.id), ...of("story").map(([id]) => id)];
  const storyIds = [...new Set(order)].filter(id => live.get(id)?.type === "story");
  const capabilityIds = new Set(of("capability").map(([id]) => id));
  const column = (contract: string, name: "reported" | "verified"): HealthState => (live.get(`health_${contract}_${name}`)?.fields.state as HealthState | undefined) ?? "not-checked";
  const unverified = !of("health").some(([, record]) => record.fields.column === "verified");
  const health = (reported: readonly HealthState[], verified: readonly HealthState[]) => ({ reported: { state: rollUp(reported) }, verified: { state: rollUp(verified) } });
  const stories = storyIds.map((id): AnnotatedStory => {
    const fields = live.get(id)!.fields;
    const capabilities = of("capability").filter(([, record]) => record.fields.story === id).map(([capability, record]): AnnotatedCapability => {
      const proposed = record.fields.proposed === true;
      const contracts = of("contract").filter(([, contract]) => contract.fields.capability === capability).map(([contract, record]) => ({
        id: contract, title: String(record.fields.title ?? ""), description: String(record.fields.description ?? ""),
        health: { reported: { state: column(contract, "reported") }, verified: { state: column(contract, "verified") } },
      }));
      const verified = rollUp(contracts.map(contract => contract.health.verified.state));
      return {
        id: capability, title: String(record.fields.title ?? ""), description: String(record.fields.description ?? ""), proposed,
        dependsOn: ((record.fields.dependsOn ?? []) as string[]).filter(on => capabilityIds.has(on)), contracts,
        health: health(contracts.map(contract => contract.health.reported.state), contracts.map(contract => contract.health.verified.state)),
        status: proposed ? "proposed" : verified === "passing" ? "healthy" : verified === "failing" ? "unhealthy" : "untested",
        ...(unverified && !proposed ? { reportOnly: true } : {}),
      } as AnnotatedCapability;
    });
    const contracts = capabilities.flatMap(capability => capability.contracts);
    return { id, title: String(fields.title ?? ""), description: String(fields.description ?? ""), capabilities,
      health: health(contracts.map(contract => contract.health.reported.state), contracts.map(contract => contract.health.verified.state)) } as AnnotatedStory;
  });
  return { ...(unverified ? { unverified } : {}), stories, arcs: [] };
}

/** The claims live at `at`, as the app's wisps: each session's claimed capabilities that it had not landed or released by then. */
function wispsAt(plan: AnnotatedTree, lines: readonly Line[], at: string): SessionWisp[] {
  const owner = new Map(plan.stories.flatMap(story => story.capabilities.map(capability => [capability.id, story.id] as const)));
  const held = new Map<string, Set<string>>();
  for (const line of lines as readonly (Line & { capability?: string })[]) {
    if (time(line.at) > time(at) || !line.session) continue;
    const mine = held.get(line.session) ?? new Set<string>();
    held.set(line.session, mine);
    if (line.kind === "claimed" && line.capability) mine.add(line.capability);
    else if ((line.kind === "landed" || line.kind === "released") && line.capability) mine.delete(line.capability);
    else if (line.kind === "session-ended" || line.kind === "closed-out") mine.clear();
  }
  return [...held].flatMap(([session, capabilities]) => {
    const byStory = new Map<string, string[]>();
    for (const capability of capabilities) { const story = owner.get(capability); if (story) byStory.set(story, [...(byStory.get(story) ?? []), capability]); }
    return [...byStory].map(([story, claimed]) => ({ session, story, colour: sessionColour(session), phase: 0, faded: false, capabilities: claimed }));
  });
}

/** Save Conduit's growth: the full plan's scene and places, and each stage's scene and live claims, scrubbed as storytree's own reading is. */
export async function refreshGrowthSnapshot(file: string, read: () => Promise<GrowthReading>): Promise<void> {
  await saveForestSnapshot(file, async () => {
    const input = await read();
    const { tree, changes, lines, project, capturedAt, window } = input;
    const from = time(window.from), to = time(window.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || !Number.isFinite(time(capturedAt))) throw new Error("The growth's recording window and capture time must be valid dates, with from before to.");
    if (input.stages.some(stage => !(time(stage.at) >= from && time(stage.at) < to))) throw new Error("Every growth stage must fall inside the recording's window.");
    const own = lines.filter(line => line.project === project);
    const surveyAt = input.surveyAt ?? (async () => ({}));
    const survey = await surveyAt(window.to, tree);
    const scene = forestScene(tree, changes, workStates(own), survey);
    const places = storyNodes(tree, changes, survey);
    const grown = growPlanet(places.map(({ id, place }) => ({ story: id, place, reach: islandCoastReach(scene.islands.find(island => island.story === id)!) })));
    const stages = [];
    for (const { id, at } of input.stages) {
      const plan = planAt(tree, changes, at);
      const before = own.filter(line => time(line.at) <= time(at));
      const capabilities = plan.stories.flatMap(story => story.capabilities);
      stages.push({ id, at, scene: forestScene(plan, changes.filter(change => time(change.record.updatedAt) <= time(at)), workStates(before), await surveyAt(at, plan)),
        wisps: wispsAt(plan, before, at), counts: { stories: plan.stories.length, capabilities: capabilities.length, contracts: capabilities.reduce((sum, item) => sum + item.contracts.length, 0) } });
    }
    const snapshot = { version: 1, capturedAt, radius: grown.radius, scene, spots: [...grown.spots], project, window, places,
      titles: Object.fromEntries(tree.stories.map(story => [story.id, story.title])), stages };
    return scrub(snapshot, []) as GrowthSnapshot;
  });
}
