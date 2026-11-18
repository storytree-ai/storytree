// Capability 8 · Storytree's own test and gate entries.
import { partialEscape, shorten } from "./nodes.mjs";

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      partialEscape: "escapes {{shown}} by a backslash and misses backslash itself (CodeQL's js/incomplete-sanitization): a backslash already in the text is left bare; " +
        'escape it too, as /[.*+?^${}()|[\\]\\\\]/g, "\\\\$&" does for a regex',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const escaped = partialEscape(node);
        if (escaped?.regex) context.report({ node, messageId: "partialEscape", data: { shown: shorten(escaped.shown) } });
      },
    };
  },
};
