// Capability 8 · Storytree's own test and gate entries.
import { methodOf, readsCmdline, repoFile, unchained } from "./nodes.mjs";

const SCOPE = /^(?:packages|apps)\//;
const TEST_FILE = /\.test\.[^/]+$/;
const COMPARES = new Set(["includes", "endsWith", "startsWith", "indexOf"]);
const NAMES = new Set(["commandLine", "CommandLine"]);
const EQUALS = new Set(["===", "!=="]);

function commandLine(subject) {
  let node = unchained(subject);
  if (node?.type === "AwaitExpression") node = unchained(node.argument);
  if (node?.type === "MemberExpression") return !node.computed && NAMES.has(node.property.name);
  return node?.type === "CallExpression" && node.arguments.some(readsCmdline);
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
        if (COMPARES.has(methodOf(node)) && commandLine(unchained(node.callee).object)) context.report({ node, messageId: "unmatched" });
      },
      BinaryExpression(node) {
        if (EQUALS.has(node.operator) && (commandLine(node.left) || commandLine(node.right))) context.report({ node, messageId: "unmatched" });
      },
    };
  },
};
