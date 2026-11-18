// Capability 5 · Package boundaries

import path from "node:path";

import { codeSurveyReader } from "@storytree/map/code-survey";

import { STORIES } from "./package-boundaries.mjs";

const NUMBERS = Array.from({ length: 99 }, (_, at) => at + 1);

export async function typeImportProblems(root, stories = STORIES) {
  const tree = { stories: stories.map((id) => ({ id, title: id, capabilities: NUMBERS.map((number) => ({ id: `${id}:${number}`, title: `${number} · ${number}` })) })) };
  const survey = await codeSurveyReader({ checkout: "current" }).read(root, tree);
  const problems = [];
  for (const [story, { edges = [] }] of Object.entries(survey)) {
    for (const edge of edges) {
      if (!edge.typeOnly || edge.story === "library" || edge.story === story) continue;
      for (const file of edge.files) {
        const from = path.posix.join("packages", story, file.from);
        const to = file.to === undefined ? `packages/${edge.story}` : path.posix.join("packages", edge.story, file.to);
        problems.push(`${from} imports, type-only, a name ${to} defines: ${valueSide(story, edges, edge, file) ?? ""}declare the fields you read in ${story}'s own package or, for a shape several stories read, move it into the library (ADR-1017 D2)`);
      }
    }
  }
  return problems.sort();
}

const numberOf = (capability) => capability?.slice(capability.lastIndexOf(":") + 1);

function valueSide(story, edges, edge, file) {
  if (edge.to === undefined || file.to === undefined) return undefined;
  for (const other of edges) {
    if (other.typeOnly || other.story !== edge.story || other.to === undefined || other.to === edge.to) continue;
    const value = other.files.find((each) => each.from === file.from && each.to !== undefined);
    if (value === undefined) continue;
    const at = path.posix.join("packages", edge.story, file.to);
    const there = path.posix.join("packages", edge.story, value.to);
    return `${at} is ${edge.story}'s capability ${numberOf(edge.to)}, while ${path.posix.join("packages", story, file.from)} imports ${there} (capability ${numberOf(other.to)}) by value; if a re-cut moved ${at}, move the type to the value edge's side, into ${there}'s capability, or `;
  }
  return undefined;
}
