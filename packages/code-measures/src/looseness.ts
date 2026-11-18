/**
 * Capability 1 · Base structure measures. Type looseness (contract 1.5, B7), read from the syntax, not the words: any
 * types (an annotation or a type argument), as and angle-bracket type assertions other than a const assertion,
 * comments holding @ts-ignore or @ts-expect-error, and comments holding eslint-disable (its -line and -next-line forms
 * included), each counted and per 1,000 source lines. A string or a name holding those words counts nothing.
 */
import { linesOf, parsed, sourcesOf, walk, type Node, type SourceText } from "./source.js";

/** The four counts, by what they count. */
export interface LoosenessCounts {
  readonly any: number;
  readonly asCasts: number;
  readonly suppressions: number;
  readonly eslintDisables: number;
}

/** A story's type looseness: each count, and each per 1,000 source lines. */
export interface LoosenessReading extends LoosenessCounts {
  readonly per1000: LoosenessCounts;
}

const SUPPRESSION = /@ts-(?:ignore|expect-error)\b/;
const ESLINT_DISABLE = /\beslint-disable\b/;

/** Whether a type assertion asserts const. */
function assertsConst(node: Node): boolean {
  const type = node.typeAnnotation as Node;
  return type.type === "TSTypeReference" && (type.typeName as Node).type === "Identifier" && (type.typeName as Node).name === "const";
}

/** `files`' type looseness over their source (B7). */
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
