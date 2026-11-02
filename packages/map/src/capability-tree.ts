/**
 * Capability 3 · Counts before detail. A story's capability tree in one read (3.11): each capability with its health
 * word and why it is not healthy, its contracts, the capabilities it depends on, and its source files with their lines
 * of code as the code survey counts them (tests left out), and the story's files no capability claims. Sizing a story's
 * territories needs no call per capability.
 */
import type { AnnotatedTree, CapabilityStatus, CapabilityWhy } from "@storytree/library";

import { packageOf } from "./code-survey/code-survey.js";
import type { ProjectSurvey } from "./code-survey/read-survey.js";
import { normalizePath } from "./graph.js";

export interface TreeFile {
  readonly path: string;
  readonly lines: number;
}
export interface TreeCapability {
  readonly id: string;
  readonly title: string;
  readonly health: CapabilityStatus;
  readonly why?: CapabilityWhy;
  readonly dependsOn: readonly string[];
  readonly contracts: readonly { readonly id: string; readonly number?: string; readonly title: string }[];
  readonly files: readonly TreeFile[];
  readonly lines: number;
}
export interface CapabilityTree {
  readonly story: { readonly id: string; readonly title: string };
  readonly capabilities: readonly TreeCapability[];
  readonly unclaimed: readonly TreeFile[];
}

/** The story `select` names (story:<name|id>, or a bare id or title), joined to its survey; an unknown one is refused. */
export function capabilityTreeOf(tree: AnnotatedTree, survey: ProjectSurvey, select: string): CapabilityTree {
  const wanted = select.startsWith("story:") ? select.slice(6) : select;
  const story = tree.stories.find(each => each.id === wanted || each.title.toLowerCase() === wanted.toLowerCase());
  if (story === undefined) throw new Error(`Map selection not found: ${select}`);
  const read = survey[story.id];
  // Paths as the map's file nodes carry them: a mapped story's from its imported folder, a built story's from the repository.
  const pathname = (file: string): string => read?.mapped !== undefined
    ? `${read.mapped.folder.replaceAll("\\", "/").replace(/\/$/, "")}/${file}`
    : normalizePath(`packages/${packageOf(story)}/${file}`);
  const files = (capability: string | undefined): TreeFile[] => (read?.files ?? [])
    .filter(file => file.capability === capability)
    .map(file => ({ path: pathname(file.path), lines: file.lines }));
  return {
    story: { id: story.id, title: story.title },
    capabilities: story.capabilities.map(cap => {
      const own = files(cap.id);
      return {
        id: cap.id, title: cap.title, health: cap.status, ...(cap.why === undefined ? {} : { why: cap.why }), dependsOn: cap.dependsOn,
        contracts: cap.contracts.map(contract => {
          const number = /^\s*(\d+\.\d+)\b/.exec(contract.title)?.[1];
          return { id: contract.id, ...(number === undefined ? {} : { number }), title: contract.title };
        }),
        files: own, lines: own.reduce((sum, file) => sum + file.lines, 0),
      };
    }),
    unclaimed: files(undefined),
  };
}

/** The tree as text: a line per capability, its files indented under it, then the unclaimed files. */
export function formatCapabilityTree(answer: CapabilityTree): string {
  const fileLines = (files: readonly TreeFile[]): string[] => files.map(file => `    ${file.path}  ${file.lines}`);
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
  const lines = [`${answer.story.title}  [${answer.story.id}]`];
  for (const cap of answer.capabilities) {
    const titles = new Map(cap.contracts.map(contract => [contract.id, contract.number ?? contract.id]));
    const word = cap.why === undefined ? cap.health : `${cap.health} — ${cap.why.reason}, the ${cap.why.mover}'s to move${cap.why.contracts.length === 0 ? "" : `: ${cap.why.contracts.map(id => titles.get(id) ?? id).join(", ")}`}`;
    lines.push(`  ${cap.title}  [${cap.id}]  ${word}; ${plural(cap.lines, "line")} in ${plural(cap.files.length, "file")}; ${plural(cap.contracts.length, "contract")}${cap.dependsOn.length === 0 ? "" : `; depends on ${cap.dependsOn.join(", ")}`}`);
    lines.push(...fileLines(cap.files));
  }
  if (answer.unclaimed.length > 0) {
    lines.push(`  Unclaimed: ${plural(answer.unclaimed.reduce((sum, file) => sum + file.lines, 0), "line")} in ${plural(answer.unclaimed.length, "file")}`);
    lines.push(...fileLines(answer.unclaimed));
  }
  return lines.join("\n");
}
