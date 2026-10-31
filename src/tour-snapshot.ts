// Capability 3 · Saved snapshot. Node-only refresh policy. Drawing and storage stay in the app's public exports.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AnnotatedTree, ArcView, Change, Holds, Line } from "@storytree/library";
import { forestScene, storyNodes } from "@storytree/forest";
import { replaceMachines } from "@storytree/forest/evidence-seed";
import type { ProjectSurvey } from "@storytree/forest/code-survey";
import { saveForestSnapshot } from "@storytree/forest/snapshot";
import { sheetLayout } from "@storytree/forest/view";
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

const kinds = new Set(["session-started", "session-ended", "subagent-started", "note-read", "claimed", "released", "landed", "closed", "merged", "closed-out"]);
const knowledge = new Set(["story", "capability", "decision", "definition", "principle", "guardrail", "pattern", "process", "agent", "techstack"]);
const privateFields = new Set(["folder", "machine", "transcript", "branch", "task"]);
const pick = (value: object, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, (value as Record<string, unknown>)[key]]));

// Recognisable credentials and credential assignments fail closed. Never echo the offending value.
const credential = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|ya29\.[A-Za-z0-9_-]+)|\bBearer\s+[A-Za-z0-9._~-]{16,}|[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|private[_-]?key)\b["']?\s*[:=]\s*["']?[^\s"',;]+/i;

// Arcs the site never shows; their increments, questions and every record naming them go with them.
const unlisted = new Set(["arc_bfbc3b617d69", "arc_824a506f2125"]);
/** The unlisted arcs' ids with their increments' and questions'. */
export const unlistedIds = (arcs: readonly ArcView[]): Set<string> => new Set([...unlisted, ...arcs.filter(view => unlisted.has(view.arc.id))
  .flatMap(view => [...view.increments, ...view.questions].map(record => record.id))]);
const names = (value: unknown, ids: ReadonlySet<string>) => { const text = JSON.stringify(value); return [...ids].some(id => text.includes(id)); };

/** The library's history as the knowledge core reads it: its notes and the stories and capabilities they hang on, with only their public fields. */
export const publicNotes = (changes: readonly Change[], hidden: ReadonlySet<string> = unlisted) => changes.filter(change => knowledge.has(change.type) && !names(change, hidden)).map(change => ({
  ...pick(change, ["seq", "recordId", "type", "action"]),
  record: { ...pick(change.record, ["id", "type", "version", "createdAt", "updatedAt"]), fields: pick(change.record.fields, ["title", "number", "status", "frontCoverOf", "links", "supersedes", "story"]) },
}));

/** The plan as the story panels read it: each story, capability and contract with only its public fields and health. */
export const publicPlan = (tree: AnnotatedTree) => ({
  ...pick(tree, ["unverified"]), arcs: [],
  stories: tree.stories.map(story => ({ ...pick(story, ["id", "title", "description", "health"]),
    capabilities: story.capabilities.map(capability => ({ ...pick(capability, ["id", "title", "description", "proposed", "dependsOn", "status", "health", "why", "reportOnly"]),
      contracts: capability.contracts.map(contract => pick(contract, ["id", "title", "description", "health"])) })) })),
});

const recordKeys = ["id", "type", "version", "createdAt", "updatedAt"];
const publicRecord = <T extends { fields: object }>(record: T, keys: readonly string[]) => ({ ...pick(record, recordKeys), fields: pick(record.fields, keys) }) as unknown as T;

/** The arcs as the board draws them: each arc's title and priority, and each increment's title, status, parked day,
 * capabilities and how it closed (its disposition and pull request). No objective, outcome note, body or question. */
export const publicArcs = (arcs: readonly ArcView[]): ArcView[] => arcs.filter(view => !unlisted.has(view.arc.id)).map(view => ({
  ...pick(view, ["state", "wakes"]) as Pick<ArcView, "state" | "wakes">,
  arc: publicRecord(view.arc, ["title", "stories", "priority"]),
  increments: view.increments.map(increment => {
    const kept = publicRecord(increment, ["arc", "title", "status", "parked", "capabilities"]);
    const { disposition, pr } = increment.fields.outcome ?? {};
    return { ...kept, fields: { ...kept.fields, ...(disposition === undefined ? {} : { disposition }), ...(pr === undefined ? {} : { pr }) } };
  }),
  questions: [],
}));

// Free text a session wrote on a line: a claim or end reason and a close-out why, kept blank so the line still reads.
const said = new Set(["reason", "why"]);
/** The activity the sessions and arcs surfaces replay: their kinds of line, inside the recording's window, with no text a session wrote on them. */
export const publicActivity = (lines: readonly Line[], window: { from: string; to: string }, hidden: ReadonlySet<string> = unlisted) =>
  lines.filter(line => kinds.has(line.kind) && Date.parse(line.at) >= Date.parse(window.from) && Date.parse(line.at) < Date.parse(window.to) && !names(line, hidden))
    .map(line => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, said.has(key) ? "" : value])) as Line);

/** What the board's work waits on, by name alone: each wait's reason is blank. */
export const publicWaits = (waits: Holds["waits"], ids: ReadonlySet<string>): Holds["waits"] =>
  Object.fromEntries(Object.entries(waits).filter(([id]) => ids.has(id)).map(([id, held]) => [id, held.map(({ on, forGood }) => ({ on, reason: "", forGood }))]));

const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Session and holder ids, wherever they appear, become opaque ones: the same id the same opaque one, so the sessions still tell apart. */
export function opaqueSessions<T>(value: T): T {
  const opaque = new Map<string, string>();
  const of = (id: string) => opaque.get(id) ?? opaque.set(id, `session-${opaque.size + 1}`).get(id)!;
  const walk = (item: unknown, key?: string): unknown => {
    if (typeof item === "string") return key === "session" || key === "holder" || key === "takenOverFrom" ? of(item) : item.replace(uuid, of);
    if (Array.isArray(item)) return item.map(entry => walk(entry));
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([name, entry]) => [name, walk(entry, name)]));
    return item;
  };
  return walk(value) as T;
}

// People's names kept off the site, as sha-256 digests so the source names no one either.
const testers = new Set(["24b6bef25e6e1efd34fdef52e772b39bfd818a77b5eea88f1badfe790361b7e5"]);
const digests = new Map<string, string>();
const digest = (word: string) => digests.get(word) ?? digests.set(word, createHash("sha256").update(word).digest("hex")).get(word)!;
const redactions = (people: ReadonlySet<string>): readonly (readonly [RegExp, (match: string) => string])[] => [
  [/https?:\/\/(?:claude\.ai\/(?:public\/)?(?:artifacts?|code|share)|(?:drive|docs)\.google\.com)\/[^\s"'<>)\]]*/gi, () => "[private link]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, () => "[email]"],
  [/\b[A-Za-z_][\w.-]*@[A-Za-z][\w-]*\b/g, () => "[user at host]"],
  [/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\b/gi, () => "[machine]"],
  [/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g, () => "[address]"],
  [/\bperson:[^\s"'<>,;)]+/g, () => "person:[someone]"],
  [/\b[A-Z][a-z]+\b(?!['’]t\b)/g, word => people.has(digest(word)) ? "a friend tester" : word],
];

// Who wrote a record is said by role: a session is an agent, anyone else the owner.
const writers = new Set(["scribedBy", "settledBy", "writer"]);
const role = (who: unknown) => who === "owner" || who === "agent" ? who : typeof who === "string" && who.startsWith("session") ? "agent" : "owner";

/** Apply to every retained value, including prose and nested records. Private names, addresses and links are replaced, writers named by role; a credential refuses. */
export function scrub(value: unknown, cloudIds: readonly string[], people: ReadonlySet<string> = testers): unknown {
  if (typeof value === "string") {
    if (credential.test(value)) throw new Error("Snapshot refused: credential-like content in a retained value; saved file kept.");
    let text = value
      .replace(/(?:\/(?:home|Users)\/[^\s/"'<>]+|[A-Z]:\\Users\\[^\s\\"'<>]+|~[\\/])[^\s"'<>),;]*/gi, "[home]")
      .replace(/\b[a-z][a-z0-9-]{4,}:[a-z]+-[a-z]+\d:[a-z][a-z0-9-]+\b/g, "[cloud-instance]")
      .replace(/\bprojects\/[a-z0-9][a-z0-9-]{4,}/g, "projects/[cloud-project]")
      .replace(/\bquestion_[0-9a-f]{6,}\b/g, "a question");
    for (const id of cloudIds) if (id) text = text.replaceAll(id, "[cloud-project]");
    for (const [pattern, by] of redactions(people)) text = text.replace(pattern, by);
    return replaceMachines(text, () => "[machine]");
  }
  if (Array.isArray(value)) return value.map(item => scrub(item, cloudIds, people));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, item]) => {
    if (/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|private[_-]?key)$/i.test(key) && item) throw new Error("Snapshot refused: credential field in a retained record; saved file kept.");
    return [key, writers.has(key) ? role(item) : scrub(item, cloudIds, people)];
  }));
  return value;
}

/** The last pass before a tour snapshot is saved, also run over a saved one from its own contents: opaque sessions, then the scrub. */
export const publishable = (snapshot: object, cloudIds: readonly string[]) => scrub(opaqueSessions(snapshot), cloudIds) as TourSnapshot;

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
    // Each island where the glass sheet lays the plan (ADR-1043 D2).
    const grown = sheetLayout(scene, new Map(places.map(({ id, place }) => [id, place])));
    const hidden = unlistedIds(input.arcs);
    const arcs = publicArcs(input.arcs.filter(view => view.state !== "closed"));
    const boardIds = new Set(arcs.flatMap(view => [view.arc.id, ...view.increments.map(increment => increment.id)]));
    const snapshot = {
      version: 1, capturedAt, radius: grown.radius, scene, spots: [...grown.spots], project, places, tree: publicPlan(tree),
      changes: publicNotes(changes, hidden),
      arcs, holds: { waits: publicWaits(input.holds.waits, boardIds), heldOn: {} },
      recording: { window, lines: publicActivity(lines, window, hidden) },
    };
    return publishable(snapshot, input.cloudProjectIds);
  });
}
