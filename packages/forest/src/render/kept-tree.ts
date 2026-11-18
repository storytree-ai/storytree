// Capability 3 · Story node render
import { pageKept, type Kept, type PageStorage } from "@storytree/arc-surface";
import type { AnnotatedTree, Change, StorySurvey } from "@storytree/library";

import type { PartState, PartStates } from "../capability-tree/capability-tree.js";
import { KEPT_DRAWING_KEY, KEPT_TREE_KEY } from "./kept-keys.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasNode = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && typeof value.id === "string" && typeof value.title === "string" && isObject(value.health);

function isAnnotatedTree(value: unknown): value is AnnotatedTree {
  return isObject(value) && Array.isArray(value.arcs) && Array.isArray(value.stories)
    && value.stories.every((story) => hasNode(story) && Array.isArray(story.capabilities)
      && story.capabilities.every((capability) => hasNode(capability) && Array.isArray(capability.dependsOn) && Array.isArray(capability.contracts)));
}

export function keptTree(project: string, storage?: PageStorage | null): Kept<AnnotatedTree> {
  const key = `${KEPT_TREE_KEY}${project}`;
  return storage === undefined ? pageKept(key, isAnnotatedTree) : pageKept(key, isAnnotatedTree, storage);
}

interface Drawing {
  survey: Record<string, StorySurvey>;
  created: string[];
  parts: Record<string, Exclude<PartState, "planned">>;
}

export interface KeptDrawing {
  survey: Readonly<Record<string, StorySurvey>>;
  created: readonly Pick<Change, "type" | "action" | "recordId">[];
  states: PartStates;
}

const PARTS: ReadonlySet<unknown> = new Set(["in-progress", "landed"]);

function isDrawing(value: unknown): value is Drawing {
  return isObject(value) && isObject(value.survey) && Array.isArray(value.created) && isObject(value.parts)
    && Object.values(value.survey).every((story) => isObject(story) && Array.isArray(story.files) && Array.isArray(story.imports))
    && value.created.every((id) => typeof id === "string") && Object.values(value.parts).every((state) => PARTS.has(state));
}

export function drawingOf(tree: AnnotatedTree, history: readonly Pick<Change, "type" | "action" | "recordId">[], states: PartStates,
  survey: Readonly<Record<string, StorySurvey>>): Drawing {
  const parts: Drawing["parts"] = {};
  for (const story of tree.stories) for (const { id } of story.capabilities) {
    const state = states.part(id);
    if (state !== "planned") parts[id] = state;
  }
  return {
    survey: Object.fromEntries(Object.entries(survey).map(([story, { tests: _tests, ...drawn }]) => [story, drawn])),
    created: [...new Set(history.filter(({ type, action }) => type === "story" && action === "created").map(({ recordId }) => recordId))],
    parts,
  };
}

export function keptDrawing(project: string, storage?: PageStorage | null): { read(): KeptDrawing | undefined; write(drawing: Drawing): void } {
  const key = `${KEPT_DRAWING_KEY}${project}`;
  const kept = storage === undefined ? pageKept(key, isDrawing) : pageKept(key, isDrawing, storage);
  return {
    read() {
      const drawing = kept.read();
      if (drawing === undefined) return undefined;
      const { survey, created, parts } = drawing;
      return {
        survey,
        created: created.map((recordId) => ({ type: "story", action: "created", recordId })),
        states: { part: (id) => parts[id] ?? "planned" },
      };
    },
    write: (drawing) => kept.write(drawing),
  };
}
