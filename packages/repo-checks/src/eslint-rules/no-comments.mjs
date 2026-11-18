// Capability 8 · Storytree's own test and gate entries.
const RULE = "storytree/no-comments";
const CAPABILITY = /^Capability \d+ ·/;
const KEPT = [/^posix-only:\s*\S/, /^(?:(?:the|this|a)\s+)?(?:wait|sleep|pause|delay)\b.*\bunder test\b/i, /^@ts-(?:expect-error|ignore)\b/, /^\/\s*<reference\b.*\/>$/];
const REFUSED = "This comment's content goes to a decision or the library, not the code (ADR-1366, ADR-1369).";

const names = (directive) => directive.value.split(",").map((name) => name.trim()).filter(Boolean);
const silences = (directive) => directive.type !== "enable" && (names(directive).length === 0 || names(directive).includes(RULE));
const isHatch = (directive) => directive.type === "disable-next-line" && names(directive).includes(RULE);

export default {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      comment: REFUSED,
      hatched: REFUSED,
      needsReason: "This next-line disable of storytree/no-comments needs a reason: end it with -- <reason>.",
      onlyNextLine: "This disable would silence storytree/no-comments, but only a next-line disable with a reason keeps a comment: // eslint-disable-next-line storytree/no-comments -- <reason>, on the line before it.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const hatchedLines = new Set();
        for (const directive of sourceCode.getDisableDirectives().directives) {
          if (!silences(directive)) continue;
          if (!isHatch(directive)) context.report({ loc: directive.node.loc, messageId: "onlyNextLine" });
          else if (directive.justification.trim() === "") context.report({ loc: directive.node.loc, messageId: "needsReason" });
          else hatchedLines.add(directive.node.loc.end.line + 1);
        }
        const directives = new Set(sourceCode.getInlineConfigNodes());
        const comments = sourceCode.getAllComments().filter((comment) => comment.type !== "Shebang" && !sourceCode.text.startsWith("#!", comment.range[0]));
        comments.forEach((comment, index) => {
          const text = comment.value.trim();
          if (directives.has(comment) || KEPT.some((kept) => kept.test(text))) return;
          if (index === 0 && CAPABILITY.test(text) && sourceCode.getTokenBefore(comment) === null) return;
          context.report({ loc: comment.loc, messageId: hatchedLines.has(comment.loc.start.line) ? "hatched" : "comment" });
        });
      },
    };
  },
};
