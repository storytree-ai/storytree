/**
 * Capability 1 · Base structure measures, as text (contract 1.7): per story, size first, then complexity, length,
 * duplication, coupling, public surface, type looseness and churn, with comment share as context. Report only: it
 * prints readings, never a bar to meet or a judgement of them.
 */
import type { MeasuresReading, StoryMeasures } from "./read.js";

const whole = (value: number): string => value.toLocaleString("en-GB");
const one = (value: number): string => value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const two = (value: number): string => value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const percent = (share: number): string => `${one(share * 100)}%`;
const orNone = (value: number | null | undefined): string => (value === null || value === undefined ? "none" : whole(value));
const plural = (count: number, word: string): string => `${whole(count)} ${word}${count === 1 ? "" : "s"}`;

/** One story's lines. */
function storyLines(story: StoryMeasures): string[] {
  const head = `${story.title} (${story.id}) · ${story.packages.map((own) => `packages/${own}`).join(", ")}`;
  if (story.missing !== undefined) return [head, `  not measured: ${story.missing}`];
  const { size, complexity, duplication, coupling, surface, looseness, churn } = story as Required<StoryMeasures>;
  const longest = complexity.longestFile === null ? "none" : `${complexity.longestFile.path} (${plural(complexity.longestFile.lines, "line")})`;
  const loose = looseness.per1000;
  const top = churn.top.map((file) => `    ${file.path}: churn ${whole(file.churn)} × complexity ${whole(file.complexity)} = ${whole(file.score)}`);
  return [
    head,
    `  size         ${plural(size.sourceLines, "source line")} in ${plural(size.files, "file")}; ${plural(size.testLines, "test line")} beside them`,
    `  comments     ${plural(size.commentLines, "line")}, ${percent(size.commentShare)} of source lines (context)`,
    `  complexity   ${plural(complexity.functions, "function")}: p90 ${orNone(complexity.p90)}, max ${orNone(complexity.max)}, ${one(complexity.per1000)} per 1,000 lines`,
    `  length       p90 ${orNone(complexity.lengthP90)}, max ${orNone(complexity.lengthMax)} lines; longest file ${longest}`,
    `  duplication  ${percent(duplication.share)} of ${plural(duplication.tokens, "token")} in clones of 50 tokens or more`,
    `  coupling     uses ${coupling.dependencies.length} (${coupling.dependencies.join(", ") || "none"}), used by ${coupling.dependents.length} (${coupling.dependents.join(", ") || "none"}); instability ${coupling.instability === null ? "none" : one(coupling.instability)}`,
    `  surface      ${plural(surface, "exported name")}`,
    `  looseness    any ${whole(looseness.any)} (${one(loose.any)}/1,000), casts ${whole(looseness.asCasts)} (${one(loose.asCasts)}/1,000), ts-ignore and ts-expect-error ${whole(looseness.suppressions)} (${one(loose.suppressions)}/1,000), eslint-disable ${whole(looseness.eslintDisables)} (${one(loose.eslintDisables)}/1,000)`,
    `  churn        +${whole(churn.added)} −${whole(churn.deleted)} lines, relative churn ${two(churn.relative)} (over source lines)${top.length === 0 ? "" : "; top files by churn × complexity:"}`,
    ...top,
  ];
}

/** The reading as text: the commit and window, then each story. */
export function measuresText(reading: MeasuresReading): string {
  const head = `Code measures at ${reading.commit.slice(0, 12)} (${reading.committed.slice(0, 10)}); churn over ${reading.window.days} days, ${reading.window.from} to ${reading.window.to}. Report only.`;
  return [head, ...reading.stories.flatMap((story) => ["", ...storyLines(story)])].join("\n");
}
