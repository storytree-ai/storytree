// Capability 1 · Base structure measures
import { linesOf, parsed, sourcesOf, walk, type Node, type SourceText } from "./source.js";

export interface LoosenessCounts {
  readonly any: number;
  readonly asCasts: number;
  readonly suppressions: number;
  readonly eslintDisables: number;
}

export interface LoosenessReading extends LoosenessCounts {
  readonly per1000: LoosenessCounts;
}

const SUPPRESSION = /@ts-(?:ignore|expect-error)\b/;
const ESLINT_DISABLE = /\beslint-disable\b/;

function assertsConst(node: Node): boolean {
  const type = node.typeAnnotation as Node;
  return type.type === "TSTypeReference" && (type.typeName as Node).type === "Identifier" && (type.typeName as Node).name === "const";
}

export function loosenessOf(files: readonly SourceText[]): LoosenessReading {
  let any = 0;
  let asCasts = 0;
  let suppressions = 0;
  let eslintDisables = 0;
  let lines = 0;
  for (const file of sourcesOf(files)) {
    lines += linesOf(file);
    const { program, comments } = parsed(file);
    for (const comment of comments) {
      if (SUPPRESSION.test(comment.value)) suppressions++;
      if (ESLINT_DISABLE.test(comment.value)) eslintDisables++;
    }
    if (program === undefined) continue;
    for (const node of walk(program)) {
      if (node.type === "TSAnyKeyword") any++;
      else if ((node.type === "TSAsExpression" || node.type === "TSTypeAssertion") && !assertsConst(node)) asCasts++;
    }
  }
  const per = (count: number) => (lines === 0 ? 0 : (count * 1000) / lines);
  return { any, asCasts, suppressions, eslintDisables, per1000: { any: per(any), asCasts: per(asCasts), suppressions: per(suppressions), eslintDisables: per(eslintDisables) } };
}
