// Capability 8 · Storytree's own test and gate entries.
import { literal, repoFile, unchained } from "./nodes.mjs";

const GROUPS = new Set(["pr", "issue"]);
const NUMBER_SUBCOMMANDS = new Set(["view", "checks", "diff", "merge", "comment", "edit", "close", "reopen", "ready", "review"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const EXEMPT = new Map([
  ["packages/agent-pool/src/watch.mjs", "openerOf"],
  ["packages/arc-surface/src/verbs/arcs.ts", "mergedPull"],
]);

function lists(call) {
  const out = [];
  for (const arg of call.arguments) {
    if (arg.type === "ArrayExpression") out.push(arg.elements);
    if (arg.type === "ConditionalExpression") for (const branch of [arg.consequent, arg.alternate]) if (branch.type === "ArrayExpression") out.push(branch.elements);
  }
  return out;
}

function namesRepo(element) {
  if (!element) return false;
  if (element.type === "SpreadElement") {
    const argument = unchained(element.argument);
    const branches = argument.type === "ConditionalExpression" ? [argument.consequent, argument.alternate] : [argument];
    return branches.some((branch) => branch.type === "ArrayExpression" && branch.elements.some(namesRepo));
  }
  const value = literal(element) ?? (element.type === "TemplateLiteral" ? element.quasis[0].value.cooked : undefined);
  return value === "-R" || value === "--repo" || (value?.startsWith("--repo=") ?? false);
}

function unnamed(list) {
  const at = list.findIndex((element, index) => GROUPS.has(literal(element)) && NUMBER_SUBCOMMANDS.has(literal(list[index + 1])));
  if (at < 0) return false;
  const numbered = list.slice(at + 2).some((element) => element && element.type !== "SpreadElement" && literal(element) === undefined);
  return numbered && !list.some(namesRepo);
}

function nameOf(fn) {
  if (fn.type === "FunctionDeclaration") return fn.id?.name;
  const holder = fn.parent;
  if (holder?.type === "Property" && holder.value === fn) return holder.key.type === "Identifier" ? holder.key.name : literal(holder.key);
  if (holder?.type === "VariableDeclarator" && holder.id.type === "Identifier") return holder.id.name;
  return fn.id?.name;
}

function enclosingName(node) {
  for (let up = node.parent; up; up = up.parent) {
    if (!FUNCTIONS.has(up.type)) continue;
    const name = nameOf(up);
    if (name !== undefined) return name;
  }
  return undefined;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unnamed: "reads a gh pr or issue number with no repository named (escape_20e13274224a): gh reads it on whichever repository the working folder's remote names; " +
        "pass -R with the repository the number came with",
    },
  },
  create(context) {
    const exempt = EXEMPT.get(repoFile(context));
    return {
      CallExpression(node) {
        if (!lists(node).some(unnamed)) return;
        if (exempt !== undefined && enclosingName(node) === exempt) return;
        context.report({ node, messageId: "unnamed" });
      },
    };
  },
};
