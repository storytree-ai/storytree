// Node-only refresh policy. Drawing and storage stay in the app's public exports.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Line } from "@storytree/agent-link";
import type { AnnotatedTree, ArcView, Change, Holds } from "@storytree/library";
import { forestScene, growPlanet, storyNodes } from "@storytree/forest";
import type { ProjectSurvey } from "@storytree/forest/code-survey";
import { saveForestSnapshot } from "@storytree/forest/snapshot";
import { islandCoastReach } from "@storytree/forest-world/geometry";
import type { TourSnapshot } from "./forest-data.js";

export interface TourReading {
  project: string;
  capturedAt: string;
  window: { from: string; to: string };
  cloudProjectIds: readonly string[];
  tree: AnnotatedTree;
  changes: readonly Change[];
  survey: ProjectSurvey;
  arcs: readonly ArcView[];
  holds: Holds;
  lines: readonly Line[];
}

const kinds = new Set(["session-started", "session-ended", "session-named", "subagent-started", "note-read", "claimed", "released", "landed", "closed", "merged", "closed-out"]);
const knowledge = new Set(["story", "capability", "decision", "definition", "principle", "guardrail", "pattern", "process", "agent", "techstack"]);
const privateFields = new Set(["folder", "machine", "transcript", "branch", "task"]);
const pick = (value: object, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, (value as Record<string, unknown>)[key]]));

// Recognisable credentials and credential assignments fail closed. Never echo the offending value.
const credential = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|ya29\.[A-Za-z0-9_-]+)|\bBearer\s+[A-Za-z0-9._~-]{16,}|[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|private[_-]?key)\b["']?\s*[:=]\s*["']?[^\s"',;]+/i;

/** Apply to every retained value, including prose and nested records. */
export function scrub(value: unknown, cloudIds: readonly string[]): unknown {
  if (typeof value === "string") {
    if (credential.test(value)) throw new Error("Snapshot refused: credential-like content in a retained value; saved file kept.");
    let text = value
      .replace(/(?:\/(?:home|Users)\/[^\s/"'<>]+|[A-Z]:\\Users\\[^\s\\"'<>]+|~[\\/])[^\s"'<>),;]*/gi, "[home]")
      .replace(/\b[a-z][a-z0-9-]{4,}:[a-z]+-[a-z]+\d:[a-z][a-z0-9-]+\b/g, "[cloud-instance]")
      .replace(/\bprojects\/[a-z][a-z0-9-]{4,}/g, "projects/[cloud-project]");
    for (const id of cloudIds) if (id) text = text.replaceAll(id, "[cloud-project]");
    return text;
  }
  if (Array.isArray(value)) return value.map(item => scrub(item, cloudIds));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, item]) => {
    if (/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|private[_-]?key)$/i.test(key) && item) throw new Error("Snapshot refused: credential field in a retained record; saved file kept.");
    return [key, scrub(item, cloudIds)];
  }));
  return value;
}

export async function refreshTourSnapshot(file: string, read: () => Promise<TourReading>): Promise<void> {
  await saveForestSnapshot(file, async () => {
    const input = await read();
    const { tree, changes, survey, project, capturedAt, window } = input;
    const from = Date.parse(window.from), to = Date.parse(window.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || !Number.isFinite(Date.parse(capturedAt))) throw new Error("Snapshot recording window and capture time must be valid dates, with from before to.");
    const lines = input.lines.filter(line => line.project === project);
    // The refresh command resolves the forest's already-installed public arc-surface dependency.
    // No private source path or browser dependency is introduced by this Node-only read.
    const resolve = createRequire(import.meta.resolve("@storytree/forest"));
    const { workStates } = await import(pathToFileURL(resolve.resolve("@storytree/arc-surface")).href) as { workStates(lines: readonly Line[]): Parameters<typeof forestScene>[2] };
    const scene = forestScene(tree, changes, workStates(lines), survey);
    const places = storyNodes(tree, changes, survey);
    const grown = growPlanet(places.map(({ id, place }) => ({ story: id, place, reach: islandCoastReach(scene.islands.find(island => island.story === id)!) })));
    const arcs = input.arcs.filter(view => view.state !== "closed");
    const boardIds = new Set(arcs.flatMap(view => [view.arc.id, ...view.increments.map(increment => increment.id)]));
    const plan = {
      ...pick(tree, ["unverified"]), arcs: [],
      stories: tree.stories.map(story => ({ ...pick(story, ["id", "title", "description", "health"]),
        capabilities: story.capabilities.map(capability => ({ ...pick(capability, ["id", "title", "description", "proposed", "dependsOn", "status", "health", "why", "reportOnly"]),
          contracts: capability.contracts.map(contract => pick(contract, ["id", "title", "description", "health"])) })) })),
    };
    const snapshot = {
      version: 1, capturedAt, radius: grown.radius, scene, spots: [...grown.spots], project, places, tree: plan,
      changes: changes.filter(change => knowledge.has(change.type)).map(change => ({
        ...pick(change, ["seq", "recordId", "type", "action"]),
        record: { ...pick(change.record, ["id", "type", "version", "createdAt", "updatedAt"]), fields: pick(change.record.fields, ["title", "number", "status", "frontCoverOf", "links", "supersedes", "story"]) },
      })),
      arcs, holds: { waits: Object.fromEntries(Object.entries(input.holds.waits).filter(([id]) => boardIds.has(id))), heldOn: Object.fromEntries(Object.entries(input.holds.heldOn).filter(([id]) => boardIds.has(id))) },
      recording: { window, lines: lines.filter(line => kinds.has(line.kind) && Date.parse(line.at) >= from && Date.parse(line.at) < to) },
    };
    return scrub(snapshot, input.cloudProjectIds) as TourSnapshot;
  });
}
