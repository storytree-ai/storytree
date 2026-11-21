// Capability 8 · Storytree's own test and gate entries.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { repoFile } from "./nodes.mjs";

export const RECORD = "STORYTREE_LINT_RECORD";
const RULE = "storytree/no-comments";
const CAPABILITY = /^Capability \d+ ·/;
const KEPT = [/^(?:(?:the|this|a)\s+)?(?:wait|sleep|pause|delay)\b.*\bunder test\b/i, /^@ts-(?:expect-error|ignore)\b/, /^\/\s*<reference\b.*\/>$/];
const REFUSED = "This comment's content goes to a decision or the library, not the code (ADR-1366, ADR-1369).";
const NEEDS_REASON = "This next-line disable of storytree/no-comments needs a reason: end it with -- <reason>.";
const ONLY_NEXT_LINE = "This disable would silence storytree/no-comments, but only a next-line disable with a reason keeps a comment: // eslint-disable-next-line storytree/no-comments -- <reason>, on the line before it.";

const names = (directive) => directive.value.split(",").map((name) => name.trim()).filter(Boolean);
const silences = (directive) => directive.type !== "enable" && (names(directive).length === 0 || names(directive).includes(RULE));
const isHatch = (directive) => directive.type === "disable-next-line" && names(directive).includes(RULE);

function record(context, problems, hatches) {
  const folder = process.env[RECORD];
  if (!folder) return;
  const name = createHash("sha256").update(context.filename).digest("hex");
  writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({ file: repoFile(context), problems, hatches }));
}

export default {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { comment: REFUSED, hatched: REFUSED },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const problems = [];
        const hatches = [];
        const reasons = new Map();
        const { directives } = sourceCode.getDisableDirectives();
        for (const directive of directives) {
          if (!silences(directive)) continue;
          const line = directive.node.loc.start.line;
          if (!isHatch(directive)) problems.push({ line, message: ONLY_NEXT_LINE });
          else if (directive.justification.trim() === "") problems.push({ line, message: NEEDS_REASON });
          else reasons.set(directive.node.loc.end.line + 1, directive.justification.trim());
        }
        const kept = new Set(directives.map(({ node }) => node));
        const comments = sourceCode.getAllComments().filter((comment) => comment.type !== "Shebang" && !sourceCode.text.startsWith("#!", comment.range[0]));
        comments.forEach((comment, index) => {
          const text = comment.value.trim();
          if (kept.has(comment) || KEPT.some((pattern) => pattern.test(text))) return;
          if (index === 0 && CAPABILITY.test(text) && sourceCode.getTokenBefore(comment) === null) return;
          const { start, end } = comment.loc;
          if (reasons.has(start.line)) hatches.push({ line: start.line, endLine: end.line, comment: text, reason: reasons.get(start.line) });
          context.report({ loc: comment.loc, messageId: reasons.has(start.line) ? "hatched" : "comment" });
        });
        record(context, problems, hatches);
      },
    };
  },
};
