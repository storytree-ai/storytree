// Capability 8 · Storytree's own test and gate entries.
import { some, TEST_FILE } from "./assertions.mjs";
import { methodOf, repoFile, unchained } from "./nodes.mjs";

const SCOPE = /^packages\/(?:repo-checks|map|app-setup)\//;
const DERIVES = new Set(["packageOf", "packagesOf"]);

const calledName = (node) => {
  if (node.type !== "CallExpression") return undefined;
  const callee = unchained(node.callee);
  if (callee?.type === "Identifier") return callee.name;
  return callee?.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
};

const calls = (node, names) => node !== undefined && (names.has(calledName(node)) || some(node, true, (inner) => names.has(calledName(inner))));

const EXISTS = new Set(["existsSync"]);

const filtersByExistence = (callback) => (callback?.type === "Identifier" && callback.name === "existsSync") || calls(callback, EXISTS);

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      dropped: "filters by existsSync over folders derived by packageOf or packagesOf, so a story whose derived folder does not exist is dropped unsaid (escape_ea60149a4f42): say each miss instead",
    },
  },
  create(context) {
    const file = repoFile(context);
    if (!SCOPE.test(file) || TEST_FILE.test(file)) return {};
    return {
      CallExpression(node) {
        if (methodOf(node) !== "filter") return;
        const [callback] = node.arguments;
        if (!filtersByExistence(callback)) return;
        if (calls(unchained(node.callee).object, DERIVES) || calls(callback, DERIVES)) context.report({ node, messageId: "dropped" });
      },
    };
  },
};
