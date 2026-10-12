/**
 * Capability 3 · Story node render. The project's tree the forest last drew, kept in the page's storage so the next start draws it at
 * once, marked as not yet fresh, while the first read crosses the network. The forest owns its key
 * and judges the shape, so a tree kept by an older build is not drawn. Beside it the forest keeps what
 * it drew the tree with: the code's survey, the order the stories were created in and where each
 * capability stands, so the kept drawing is laid out as the fresh one will be and a start on an
 * unchanged project lays the globe out once.
 */
import { pageKept, type Kept, type PageStorage, type PartState, type WorkStates } from "@storytree/arc-surface";
import type { AnnotatedTree, Change } from "@storytree/library";
import type { StorySurvey } from "@storytree/map";

import { KEPT_DRAWING_KEY, KEPT_TREE_KEY } from "./kept-keys.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasNode = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && typeof value.id === "string" && typeof value.title === "string" && isObject(value.health);

function isAnnotatedTree(value: unknown): value is AnnotatedTree {
  return isObject(value) && Array.isArray(value.arcs) && Array.isArray(value.stories)
    && value.stories.every((story) => hasNode(story) && Array.isArray(story.capabilities)
      && story.capabilities.every((capability) => hasNode(capability) && Array.isArray(capability.dependsOn) && Array.isArray(capability.contracts)));
}

/** Project `project`'s kept tree; `storage` is the page's own unless handed one. */
export function keptTree(project: string, storage?: PageStorage | null): Kept<AnnotatedTree> {
  const key = `${KEPT_TREE_KEY}${project}`;
  return storage === undefined ? pageKept(key, isAnnotatedTree) : pageKept(key, isAnnotatedTree, storage);
}

/** What the forest drew its kept tree with, as kept: the survey without its tests, which nothing drawn reads (about 40% of it for storytree itself). */
interface Drawing {
  survey: Record<string, StorySurvey>;
  /** The stories in the order they were created: the ties in a row go by it. */
  created: string[];
  /** Each capability that is not planned, and where it stands. */
  parts: Record<string, Exclude<PartState, "planned">>;
}

/** What the kept tree is drawn with: the forest scene's history, work states and survey. */
export interface KeptDrawing {
  survey: Readonly<Record<string, StorySurvey>>;
  created: readonly Pick<Change, "type" | "action" | "recordId">[];
  states: Pick<WorkStates, "part">;
}

const PARTS: ReadonlySet<unknown> = new Set(["in-progress", "landed"]);

function isDrawing(value: unknown): value is Drawing {
  return isObject(value) && isObject(value.survey) && Array.isArray(value.created) && isObject(value.parts)
    && Object.values(value.survey).every((story) => isObject(story) && Array.isArray(story.files) && Array.isArray(story.imports))
    && value.created.every((id) => typeof id === "string") && Object.values(value.parts).every((state) => PARTS.has(state));
}

/** What to keep of a drawing of `tree` with `history`, `states` and `survey`, as the forest scene was handed them. */
export function drawingOf(tree: AnnotatedTree, history: readonly Pick<Change, "type" | "action" | "recordId">[], states: Pick<WorkStates, "part">,
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

/** What project `project`'s kept tree was drawn with, read back as the forest scene takes it; `storage` is the page's own unless handed one. */
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
