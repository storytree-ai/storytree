// Capability 8 · Storytree's own test and gate entries.
import { isReplace, literal, regexOf, unchained } from "./nodes.mjs";

const SPECIALS = [..."\\^$.*+?()[]{}|"];

function matchesEverySpecial(pattern) {
  const regex = regexOf(pattern);
  if (regex === undefined) return false;
  try {
    const compiled = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ""));
    return SPECIALS.every((special) => compiled.test(special));
  } catch {
    return false;
  }
}

function partialChain(node) {
  let backslashLed = false;
  for (let call = unchained(node); call?.type === "CallExpression" && isReplace(call); call = unchained(unchained(call.callee).object)) {
    if (matchesEverySpecial(call.arguments[0])) return false;
    if (literal(call.arguments[1])?.startsWith("\\")) backslashLed = true;
  }
  return backslashLed;
}

function oddBackslashRun(quasi) {
  const text = quasi.value.cooked ?? "";
  let end = text.length;
  while (text[end - 1] === "\\") end -= 1;
  return (text.length - end) % 2 === 1;
}

function refused(source) {
  if (source?.type !== "TemplateLiteral") return partialChain(source);
  return source.expressions.some((expression, at) => partialChain(expression) || oddBackslashRun(source.quasis[at]));
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      partialRegexpEscape: "builds a RegExp from text escaped by hand for only some regex specials (escape_159b701eadc6): the rest stay live in the pattern; " +
        'escape every special, as /[.*+?^${}()|[\\]\\\\]/g, "\\\\$&" does',
    },
  },
  create(context) {
    const check = (node) => {
      if (node.callee.type !== "Identifier" || node.callee.name !== "RegExp") return;
      if (refused(unchained(node.arguments[0]))) context.report({ node, messageId: "partialRegexpEscape" });
    };
    return { NewExpression: check, CallExpression: check };
  },
};
