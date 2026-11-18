// Capability 8 · Storytree's own test and gate entries.
import { literal, methodOf, regexOf, shorten, shownRegex } from "./nodes.mjs";

const LOOPS = new Set(["WhileStatement", "DoWhileStatement", "ForStatement", "ForOfStatement", "ForInStatement"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function removesTag(source) {
  const rest = /^(?:\((?:\?:)?)*<(.*)$/s.exec(source)?.[1];
  return rest !== undefined && rest !== "" && !/^(?:[+*?]|\{\d+(?:,\d*)?\})\??$/.test(rest);
}

function stripping(call) {
  const method = methodOf(call);
  if (method !== "replace" && method !== "replaceAll") return undefined;
  const [pattern, replacement] = call.arguments;
  const regex = regexOf(pattern);
  if (regex === undefined || !(regex.flags.includes("g") || method === "replaceAll")) return undefined;
  if (literal(replacement) !== "" || !removesTag(regex.source)) return undefined;
  return shownRegex(regex);
}

function inLoop(ancestors) {
  for (const ancestor of ancestors.toReversed()) {
    if (LOOPS.has(ancestor.type)) return true;
    if (FUNCTIONS.has(ancestor.type)) return false;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      tagStrip: 'removes {{shown}} by one global replace with "" (CodeQL\'s js/incomplete-multi-character-sanitization): what it removes can re-form from what is left; ' +
        "repeat it until nothing changes, split on the pattern instead, or escape the text rather than strip it",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const shown = stripping(node);
        if (shown !== undefined && !inLoop(context.sourceCode.getAncestors(node))) context.report({ node, messageId: "tagStrip", data: { shown: shorten(shown) } });
      },
    };
  },
};
