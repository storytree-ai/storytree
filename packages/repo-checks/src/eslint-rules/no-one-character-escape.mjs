// Capability 8 · Storytree's own test and gate entries.
import { partialEscape } from "./nodes.mjs";

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      oneCharacterEscape: "escapes {{shown}} by a backslash and misses backslash itself (CodeQL's js/incomplete-sanitization): a backslash already in the text is left bare, " +
        'and replace escapes only the first; escape backslash first in the same chain, as .replaceAll("\\\\", "\\\\\\\\") does',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const escaped = partialEscape(node);
        if (escaped !== undefined && !escaped.regex) context.report({ node, messageId: "oneCharacterEscape", data: { shown: escaped.shown } });
      },
    };
  },
};
