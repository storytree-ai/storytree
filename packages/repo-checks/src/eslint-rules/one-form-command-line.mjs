// Capability 8 · Storytree's own test and gate entries.
import { escapedBy, isReplace, literal, methodOf, readsCmdline, repoFile, unchained } from "./nodes.mjs";

const SCOPE = /^(?:packages|apps)\//;
const TEST_FILE = /\.test\.[^/]+$/;
const COMPARES = new Set(["includes", "endsWith", "startsWith", "indexOf"]);
const NAMES = new Set(["commandLine", "CommandLine"]);
const EQUALS = new Set(["===", "!=="]);

const objectOf = (call) => unchained(call.callee).object;

function forwardSlashes(call) {
  const method = methodOf(call);
  if (isReplace(call)) return escapedBy(call.arguments[0])?.backslash === "matches" && literal(call.arguments[1]) === "/";
  const split = unchained(objectOf(call));
  return method === "join" && literal(call.arguments[0]) === "/" && split?.type === "CallExpression" && methodOf(split) === "split" && literal(split.arguments[0]) === "\\";
}

function commandLine(subject) {
  let node = unchained(subject);
  if (node?.type === "AwaitExpression") node = unchained(node.argument);
  if (node?.type === "MemberExpression") return !node.computed && NAMES.has(node.property.name);
  if (node?.type !== "CallExpression") return false;
  if (node.arguments.some(readsCmdline)) return true;
  if (methodOf(node) === undefined || COMPARES.has(methodOf(node)) || forwardSlashes(node)) return false;
  return commandLine(objectOf(node));
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unmatched: "compares a process command line that is not in forward-slash form, so on Windows, where it carries backslashes, the match misses " +
        "and a live run reads as gone (escape_d5ad2f7cc448): put both sides in one form, repo-relative with forward slashes, " +
        "for example commandLine.replaceAll(\"\\\\\", \"/\").includes(relative)",
    },
  },
  create(context) {
    const file = repoFile(context);
    if (!SCOPE.test(file) || TEST_FILE.test(file)) return {};
    return {
      CallExpression(node) {
        if (COMPARES.has(methodOf(node)) && commandLine(objectOf(node))) context.report({ node, messageId: "unmatched" });
      },
      BinaryExpression(node) {
        if (EQUALS.has(node.operator) && (commandLine(node.left) || commandLine(node.right))) context.report({ node, messageId: "unmatched" });
      },
    };
  },
};
